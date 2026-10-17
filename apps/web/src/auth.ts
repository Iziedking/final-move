/**
 * NextAuth v5 config.
 * X (Twitter) OAuth 2.0 with PKCE.
 *
 * On first sign-in we call the API server-to-server (shared INTERNAL_SECRET)
 * to upsert the user row and create their Circle wallet.
 * The upsert endpoint is POST /v1/users/upsert — internal only.
 *
 * Required env vars:
 *   AUTH_SECRET (or SESSION_SECRET) — generate with: openssl rand -hex 32
 *   INTERNAL_SECRET                 — shared with API server; generate same way
 *   API_ORIGIN                      — e.g. http://localhost:3001
 *   X_CLIENT_ID
 *   X_CLIENT_SECRET
 */
import NextAuth, { type NextAuthResult } from "next-auth";
import Twitter from "next-auth/providers/twitter";

const authSecret = process.env.AUTH_SECRET ?? process.env.SESSION_SECRET;

if (!authSecret && process.env.NODE_ENV === "production") {
  throw new Error(
    "AUTH_SECRET (or SESSION_SECRET) is required in production. " +
    "Generate one with: openssl rand -hex 32",
  );
}

const API_ORIGIN     = process.env.API_ORIGIN ?? "http://localhost:3001";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "";

/** Call the API server to upsert user + create Circle wallet. Tolerates failure. */
async function upsertUserOnServer(xId: string, handle: string, avatar: string) {
  if (!xId) return;
  try {
    const res = await fetch(`${API_ORIGIN}/v1/users/upsert`, {
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "X-Internal-Key": INTERNAL_SECRET,
      },
      body: JSON.stringify({ xId, handle, avatar }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[auth] upsert failed ${res.status}:`, text.slice(0, 200));
    }
  } catch (e) {
    console.error("[auth] upsert error:", (e as Error).message);
  }
}

const result: NextAuthResult = NextAuth({
  providers: [
    Twitter({
      clientId:     process.env.X_CLIENT_ID!,
      clientSecret: process.env.X_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const p = profile as { data?: { id?: string; username?: string; profile_image_url?: string } };
        token.xId    = p.data?.id;
        token.handle = p.data?.username;
        token.avatar = p.data?.profile_image_url;

        // First sign-in: upsert user + wallet server-to-server.
        // account.access_token is only present on first sign-in, so this
        // runs exactly once per OAuth flow.
        if (token.xId) {
          await upsertUserOnServer(
            token.xId as string,
            (token.handle as string) ?? "",
            (token.avatar as string) ?? "",
          );
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.xId) {
        session.user.id     = token.xId as string;
        session.user.handle = token.handle as string;
        session.user.image  = (token.avatar as string) ?? session.user.image;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
  secret: authSecret,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handlers: any = result.handlers;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const auth: any = result.auth;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const signIn: any = result.signIn;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const signOut: any = result.signOut;

// Augment next-auth types
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      handle: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
