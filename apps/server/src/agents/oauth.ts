/**
 * One-click sign-in for agents: OAuth 2.1 for the MCP server.
 *
 * Someone adds https://<api-host>/mcp as a connector in Claude, ChatGPT or Codex. The app
 * registers itself (Dynamic Client Registration), sends the person to our consent page,
 * they sign in with X and pick or create an agent, and the app gets a token that plays as
 * that agent. No API key to copy, no config file.
 *
 * Follows the MCP authorization spec and Claude's connector requirements:
 *  - 401 with WWW-Authenticate resource_metadata starts sign-in (see mcp.ts)
 *  - protected resource metadata + RFC 8414 authorization server metadata
 *  - DCR (RFC 7591), public clients, PKCE S256 required
 *  - loopback redirects (Claude Code, Codex) match on any port
 *  - form-urlencoded token endpoint, rotating refresh tokens, invalid_grant on bad refresh
 */
import { Hono, type Context } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "../db/client.ts";
import { redis } from "../db/redis.ts";
import { cfg } from "../config/index.ts";
import { requirePlayer } from "../auth/middleware.ts";
import { registerAgent, markSeen, type AgentRecord } from "./index.ts";

const ACCESS_TTL_SEC  = 3_600;          // 1 hour
const REFRESH_TTL_SEC = 30 * 86_400;    // 30 days
const REQUEST_TTL_SEC = 600;            // the consent page has 10 minutes
const CODE_TTL_SEC    = 300;
const SCOPES = ["play", "offline_access"];

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString("hex")}`;
const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The public origin of this API, as the person typed it into their app. */
export function apiOrigin(c: Context): string {
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = c.req.header("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

export function resourceMetadataUrl(c: Context): string {
  return `${apiOrigin(c)}/.well-known/oauth-protected-resource/mcp`;
}

// ── Redirect URIs ────────────────────────────────────────────────────────────

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseRedirect(uri: string): URL | null {
  try {
    const u = new URL(uri);
    if (u.hash) return null;
    if (u.protocol === "https:") return u;
    if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return u;
    return null;
  } catch {
    return null;
  }
}

/** Exact match, except a loopback redirect may use any port (RFC 8252 7.3). */
export function redirectAllowed(registered: string[], requested: string): boolean {
  const req = parseRedirect(requested);
  if (!req) return false;
  return registered.some((r) => {
    if (r === requested) return true;
    const reg = parseRedirect(r);
    if (!reg || !LOOPBACK.has(reg.hostname) || !LOOPBACK.has(req.hostname)) return false;
    return reg.protocol === req.protocol && reg.hostname === req.hostname
      && reg.pathname === req.pathname && reg.search === req.search;
  });
}

// ── Storage ──────────────────────────────────────────────────────────────────

interface Client { id: string; name: string; redirectUris: string[] }

async function getClient(id: string): Promise<Client | null> {
  if (!/^fmc_[0-9a-f]{32}$/.test(id)) return null;
  const rows = await sql<{ id: string; name: string; redirect_uris: string }[]>`
    SELECT id, name, redirect_uris FROM oauth_clients WHERE id=${id} LIMIT 1
  `;
  const r = rows[0];
  return r ? { id: r.id, name: r.name, redirectUris: JSON.parse(r.redirect_uris) as string[] } : null;
}

async function issueTokens(agentId: string, clientId: string) {
  const access = token("fma");
  const refresh = token("fmr");
  await sql`
    INSERT INTO oauth_tokens (token_hash, kind, agent_id, client_id, expires_at) VALUES
      (${sha256(access)},  'access',  ${agentId}, ${clientId}, now() + make_interval(secs => ${ACCESS_TTL_SEC})),
      (${sha256(refresh)}, 'refresh', ${agentId}, ${clientId}, now() + make_interval(secs => ${REFRESH_TTL_SEC}))
  `;
  return {
    access_token:  access,
    token_type:    "Bearer",
    expires_in:    ACCESS_TTL_SEC,
    refresh_token: refresh,
    scope:         SCOPES.join(" "),
  };
}

/** An OAuth access token's agent, or null. Used by the MCP server next to API keys. */
export async function verifyAccessToken(raw: string): Promise<AgentRecord | null> {
  if (!raw.startsWith("fma_")) return null;
  const rows = await sql<{
    id: string; owner_id: string; name: string; model_note: string | null; status: string; created_at: Date;
  }[]>`
    SELECT a.id, a.owner_id, a.name, a.model_note, a.status, a.created_at
    FROM oauth_tokens t JOIN agents a ON a.id = t.agent_id
    WHERE t.token_hash=${sha256(raw)} AND t.kind='access' AND t.revoked=false
      AND t.expires_at > now() AND a.status='active'
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  markSeen(r.id);
  return { id: r.id, ownerId: r.owner_id, name: r.name, modelNote: r.model_note, status: "active", createdAt: r.created_at };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export const oauthRouter = new Hono();

const oauthError = (c: Context, error: string, description: string, status: 400 | 401 = 400) =>
  c.json({ error, error_description: description }, status);

function protectedResource(c: Context) {
  return c.json({
    resource:                 `${apiOrigin(c)}/mcp`,
    authorization_servers:    [apiOrigin(c)],
    scopes_supported:         SCOPES,
    bearer_methods_supported: ["header"],
    resource_name:            "Final Move",
  });
}
oauthRouter.get("/.well-known/oauth-protected-resource", protectedResource);
oauthRouter.get("/.well-known/oauth-protected-resource/mcp", protectedResource);

oauthRouter.get("/.well-known/oauth-authorization-server", (c) => {
  const o = apiOrigin(c);
  return c.json({
    issuer:                                o,
    authorization_endpoint:                `${o}/oauth/authorize`,
    token_endpoint:                        `${o}/oauth/token`,
    registration_endpoint:                 `${o}/oauth/register`,
    response_types_supported:              ["code"],
    grant_types_supported:                 ["authorization_code", "refresh_token"],
    code_challenge_methods_supported:      ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported:                      SCOPES,
  });
});

/** Dynamic Client Registration (RFC 7591). Public clients only. */
oauthRouter.post("/oauth/register", async (c) => {
  const body = (await c.req.json().catch(() => null) ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
  const rawUris: unknown = body.redirect_uris;
  const uris = Array.isArray(rawUris) ? rawUris.filter((u): u is string => typeof u === "string") : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every((u) => u.length <= 500 && parseRedirect(u))) {
    return c.json({ error: "invalid_redirect_uri", error_description: "Redirect URIs must be https, or http on localhost." }, 400);
  }
  const name = (typeof body.client_name === "string" ? body.client_name : "An app").trim().slice(0, 80) || "An app";
  const id = `fmc_${randomBytes(16).toString("hex")}`;
  await sql`
    INSERT INTO oauth_clients (id, name, redirect_uris) VALUES (${id}, ${name}, ${JSON.stringify(uris)})
  `;
  return c.json({
    client_id:                  id,
    client_id_issued_at:        Math.floor(Date.now() / 1000),
    client_name:                name,
    redirect_uris:              uris,
    grant_types:                ["authorization_code", "refresh_token"],
    response_types:             ["code"],
    token_endpoint_auth_method: "none",
  }, 201);
});

/** Start sign-in. Never redirects to a URI it hasn't validated. */
oauthRouter.get("/oauth/authorize", async (c) => {
  const q = c.req.query();
  const client = await getClient(q.client_id ?? "");
  if (!client) return c.text("Unknown app. Remove the connector and add it again.", 400);
  const redirectUri = q.redirect_uri ?? "";
  if (!redirectAllowed(client.redirectUris, redirectUri)) return c.text("This redirect address isn't registered for this app.", 400);

  const back = (error: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    if (q.state) u.searchParams.set("state", q.state);
    return c.redirect(u.toString(), 302);
  };
  if (q.response_type !== "code") return back("unsupported_response_type");
  if (!q.code_challenge || q.code_challenge_method !== "S256") return back("invalid_request");
  if (q.resource && q.resource.replace(/\/$/, "") !== `${apiOrigin(c)}/mcp`) return back("invalid_target");

  const requestId = randomBytes(16).toString("hex");
  await redis.set(`oauth:req:${requestId}`, JSON.stringify({
    clientId: client.id, clientName: client.name, redirectUri,
    codeChallenge: q.code_challenge, state: q.state ?? null, issuer: apiOrigin(c),
  }), "EX", REQUEST_TTL_SEC);
  return c.redirect(`${cfg.PUBLIC_WEB_URL.replace(/\/$/, "")}/connect?request=${requestId}`, 302);
});

interface PendingRequest {
  clientId: string; clientName: string; redirectUri: string;
  codeChallenge: string; state: string | null; issuer: string;
}

async function readRequest(id: string): Promise<PendingRequest | null> {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const raw = await redis.get(`oauth:req:${id}`);
  return raw ? JSON.parse(raw) as PendingRequest : null;
}

/** The consent page reads who is asking. Signed-in people only. */
oauthRouter.get("/v1/oauth/requests/:id", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  if (caller.type !== "user") return c.json({ error: "signed_in_user_required" }, 403);
  const req = await readRequest(c.req.param("id"));
  if (!req) return c.json({ error: "expired" }, 404);
  return c.json({ clientName: req.clientName, redirectHost: new URL(req.redirectUri).host });
});

/** The person approved: bind the app to one of their agents and send it back with a code. */
oauthRouter.post("/v1/oauth/requests/:id/approve", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  if (caller.type !== "user") return c.json({ error: "signed_in_user_required" }, 403);
  const id = c.req.param("id");
  const req = await readRequest(id);
  if (!req) return c.json({ error: "expired" }, 404);
  const body = await c.req.json().catch(() => ({})) as { agentId?: unknown; newAgent?: { name?: unknown; modelNote?: unknown } };

  let agentId: string;
  if (typeof body.agentId === "string") {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM agents WHERE id=${body.agentId} AND owner_id=${caller.sub} AND status='active' LIMIT 1
    `;
    if (!rows[0]) return c.json({ error: "That agent isn't yours." }, 403);
    agentId = rows[0].id;
  } else if (body.newAgent && typeof body.newAgent.name === "string" && body.newAgent.name.trim()) {
    try {
      const made = await registerAgent({
        ownerId: caller.sub,
        name: body.newAgent.name.trim().slice(0, 40),
        modelNote: typeof body.newAgent.modelNote === "string" ? body.newAgent.modelNote.trim().slice(0, 80) || undefined : undefined,
      });
      agentId = made.agent.id; // the API key is not needed: the app gets a token instead
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: /duplicate|unique/i.test(msg) ? "That name is taken. Try another." : msg }, 400);
    }
  } else {
    return c.json({ error: "Pick an agent or name a new one." }, 400);
  }

  // One use: the request is gone once it turns into a code.
  if (!(await redis.del(`oauth:req:${id}`))) return c.json({ error: "expired" }, 404);
  const code = randomBytes(32).toString("hex");
  await redis.set(`oauth:code:${sha256(code)}`, JSON.stringify({
    clientId: req.clientId, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge, agentId,
  }), "EX", CODE_TTL_SEC);
  const u = new URL(req.redirectUri);
  u.searchParams.set("code", code);
  if (req.state) u.searchParams.set("state", req.state);
  u.searchParams.set("iss", req.issuer);
  return c.json({ redirectTo: u.toString() });
});

oauthRouter.post("/v1/oauth/requests/:id/deny", async (c) => {
  const caller = requirePlayer(c); if (!caller) return c.res;
  const req = await readRequest(c.req.param("id"));
  if (!req) return c.json({ error: "expired" }, 404);
  await redis.del(`oauth:req:${c.req.param("id")}`);
  const u = new URL(req.redirectUri);
  u.searchParams.set("error", "access_denied");
  if (req.state) u.searchParams.set("state", req.state);
  return c.json({ redirectTo: u.toString() });
});

/** Token endpoint: form-urlencoded, per RFC 6749. */
oauthRouter.post("/oauth/token", async (c) => {
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  const f = (k: string) => (typeof form[k] === "string" ? form[k] as string : "");
  const client = await getClient(f("client_id"));
  if (!client) return oauthError(c, "invalid_client", "Unknown client. Register again.", 401);

  if (f("grant_type") === "authorization_code") {
    const key = `oauth:code:${sha256(f("code"))}`;
    const raw = await redis.get(key);
    if (!raw) return oauthError(c, "invalid_grant", "The code is invalid or expired.");
    await redis.del(key); // one use, even if the checks below fail
    const grant = JSON.parse(raw) as { clientId: string; redirectUri: string; codeChallenge: string; agentId: string };
    if (grant.clientId !== client.id) return oauthError(c, "invalid_grant", "The code belongs to another client.");
    if (f("redirect_uri") && f("redirect_uri") !== grant.redirectUri) return oauthError(c, "invalid_grant", "redirect_uri does not match.");
    const verifier = f("code_verifier");
    if (!verifier || b64url(createHash("sha256").update(verifier).digest()) !== grant.codeChallenge) {
      return oauthError(c, "invalid_grant", "PKCE verification failed.");
    }
    return c.json(await issueTokens(grant.agentId, client.id), 200, { "Cache-Control": "no-store" });
  }

  if (f("grant_type") === "refresh_token") {
    // Rotate: the old refresh token dies in the same step that issues the new pair.
    const rows = await sql<{ agent_id: string }[]>`
      UPDATE oauth_tokens SET revoked=true
      WHERE token_hash=${sha256(f("refresh_token"))} AND kind='refresh' AND client_id=${client.id}
        AND revoked=false AND expires_at > now()
      RETURNING agent_id
    `;
    if (!rows[0]) return oauthError(c, "invalid_grant", "The refresh token is invalid or expired.");
    return c.json(await issueTokens(rows[0].agent_id, client.id), 200, { "Cache-Control": "no-store" });
  }

  return oauthError(c, "unsupported_grant_type", "Use authorization_code or refresh_token.");
});
