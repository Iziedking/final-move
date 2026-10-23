/**
 * GET /api/token — swaps the signed-in Auth.js session for an API player token.
 * Runs on the web server, so INTERNAL_SECRET never reaches the browser.
 * Signed-out visitors get 401 and fall back to a guest token from the API.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { serverApiBase } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  const userId: string | undefined = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  try {
    const res = await fetch(`${serverApiBase()}/v1/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": process.env.INTERNAL_SECRET ?? "",
      },
      body: JSON.stringify({
        userId,
        handle: session.user.handle ?? session.user.name ?? undefined,
        avatar: session.user.image ?? undefined,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({ error: "bad_response" }));
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: "api_unreachable" }, { status: 502 });
  }
}
