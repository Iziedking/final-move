import { NextResponse } from "next/server";

// Only set Cache-Control: no-store in development (sandbox preview panel needs
// this to avoid stale JS chunks; production should use normal caching).
export function middleware() {
  const res = NextResponse.next();
  if (process.env.NODE_ENV !== "production") {
    res.headers.set("Cache-Control", "no-store");
  }
  return res;
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon).*)" };
