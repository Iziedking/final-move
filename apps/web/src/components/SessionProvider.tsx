"use client";
// Thin wrapper to isolate next-auth/react from root layout.
// Cast children to `any` to bridge the React 18/19 ReactNode mismatch
// between next-auth's peer dep and this workspace's @types/react@19.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextAuthSessionProvider>{children as any}</NextAuthSessionProvider>
  );
}
