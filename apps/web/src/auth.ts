/**
 * NextAuth v5 config.
 * X (Twitter) OAuth 2.0 with PKCE.
 * On first sign-in the server creates a Circle wallet for the user.
 */
import NextAuth, { type NextAuthResult } from "next-auth";
import Twitter from "next-auth/providers/twitter";

const result: NextAuthResult = NextAuth({
  providers: [
    Twitter({
      clientId: process.env.X_CLIENT_ID!,
      clientSecret: process.env.X_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const p = profile as { data?: { id?: string; username?: string; profile_image_url?: string } };
        token.xId       = p.data?.id;
        token.handle    = p.data?.username;
        token.avatar    = p.data?.profile_image_url;
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
  secret: process.env.SESSION_SECRET,
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
