"use client";
/**
 * Display names for player ids on lists (watch, leaderboard, challenge links).
 * Bots and guests resolve locally; users and agents come from one batched
 * /v1/names request and are cached for the page's lifetime.
 */
import { useEffect, useState } from "react";
import { API_BASE } from "./api";
import { botName } from "./bots";

export interface NameInfo { name: string; avatar?: string | null }

const cache = new Map<string, NameInfo>();

export function localName(id: string, kind?: string): string | null {
  if (kind === "bot" || id.startsWith("bot_")) return botName(id) ?? "House bot";
  if (id.startsWith("guest")) return "Guest";
  return null;
}

// Lookups from every component on the page within a few milliseconds share one request.
const waiting = new Map<string, Promise<NameInfo>>();
let queue: Array<{ id: string; done: (n: NameInfo) => void }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  timer = null;
  const batch = queue.splice(0, 100);
  if (queue.length > 0) timer = setTimeout(() => { void flush(); }, 0);
  const d = await fetch(`${API_BASE}/v1/names?ids=${batch.map((b) => encodeURIComponent(b.id)).join(",")}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ names?: Record<string, { name: string; avatar?: string | null }> }>) : null))
    .catch(() => null);
  for (const { id, done } of batch) {
    const n = d?.names?.[id];
    const info: NameInfo = n ? { name: n.name, avatar: n.avatar } : { name: "Player" };
    cache.set(id, info);
    waiting.delete(id);
    done(info);
  }
}

function one(id: string): Promise<NameInfo> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = waiting.get(id);
  if (!p) {
    p = new Promise<NameInfo>((done) => { queue.push({ id, done }); });
    waiting.set(id, p);
    timer ??= setTimeout(() => { void flush(); }, 10);
  }
  return p;
}

async function lookup(ids: string[]): Promise<Record<string, NameInfo>> {
  const infos = await Promise.all(ids.map(one));
  return Object.fromEntries(ids.map((id, i) => [id, infos[i]!]));
}

/** Names for a set of ids; entries fill in as lookups return. */
export function useNames(ids: Array<{ id: string; kind?: string }>): Record<string, NameInfo> {
  const [names, setNames] = useState<Record<string, NameInfo>>({});
  const key = ids.map((i) => i.id).sort().join(",");
  useEffect(() => {
    let alive = true;
    const local: Record<string, NameInfo> = {};
    const remote: string[] = [];
    for (const { id, kind } of ids) {
      const n = localName(id, kind);
      if (n) local[id] = { name: n };
      else remote.push(id);
    }
    setNames((prev) => ({ ...prev, ...local }));
    if (remote.length > 0) {
      void lookup(remote).then((found) => { if (alive) setNames((prev) => ({ ...prev, ...found })); });
    }
    return () => { alive = false; };
  }, [key]);
  return names;
}
