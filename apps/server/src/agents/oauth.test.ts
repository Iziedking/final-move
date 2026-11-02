/**
 * Tests for one-click agent sign-in (OAuth 2.1 for the MCP server), against a real
 * Postgres and Redis. Run with: bun test apps/server/src/agents/oauth.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

if (process.env.WITHDRAW_TEST_DB !== "1" || process.env.NETWORK === "mainnet") {
  throw new Error("Refusing to run: set WITHDRAW_TEST_DB=1 and point DATABASE_URL at a throwaway test database (never mainnet).");
}

import { createHash, randomBytes } from "node:crypto";
import { sql } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { mintToken } from "../auth/tokens.ts";
import { oauthRouter, redirectAllowed, verifyAccessToken } from "./oauth.ts";
import { mcpRouter } from "./mcp.ts";

const BASE = "http://localhost";
const OWNER = "u_test_oauth_1";
const STRANGER = "u_test_oauth_2";
const AGENT = "ag_testoa01";
const OTHER_AGENT = "ag_testoa02";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pkce = () => {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
};
const userAuth = (id: string) => ({ Authorization: `Bearer ${mintToken(id, "user")}` });
const clients: string[] = [];

async function register(redirectUris: string[]) {
  const r = await oauthRouter.request(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Test app", redirect_uris: redirectUris }),
  });
  const body = await r.json() as { client_id?: string };
  if (body.client_id) clients.push(body.client_id);
  return { status: r.status, clientId: body.client_id ?? "" };
}

async function authorize(clientId: string, challenge: string, redirectUri = REDIRECT) {
  const q = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: "S256", state: "st4te", resource: `${BASE}/mcp`,
  });
  return oauthRouter.request(`${BASE}/oauth/authorize?${q}`);
}

async function requestIdFrom(res: Response): Promise<string> {
  const loc = res.headers.get("location") ?? "";
  return new URL(loc).searchParams.get("request") ?? "";
}

async function approve(requestId: string, userId: string, body: unknown) {
  return oauthRouter.request(`${BASE}/v1/oauth/requests/${requestId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userAuth(userId) },
    body: JSON.stringify(body),
  });
}

async function tokenRequest(fields: Record<string, string>) {
  return oauthRouter.request(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** The full happy path: register, authorize, approve, exchange. */
async function signIn() {
  const { clientId } = await register([REDIRECT]);
  const { verifier, challenge } = pkce();
  const requestId = await requestIdFrom(await authorize(clientId, challenge));
  const ok = await approve(requestId, OWNER, { agentId: AGENT });
  const { redirectTo } = await ok.json() as { redirectTo: string };
  const code = new URL(redirectTo).searchParams.get("code") ?? "";
  const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
  return { clientId, verifier, code, tok, tokens: await tok.json() as { access_token: string; refresh_token: string; error?: string } };
}

beforeAll(async () => {
  await runMigrations();
  await sql`INSERT INTO users (id, handle) VALUES (${OWNER}, 'oauth_owner'), (${STRANGER}, 'oauth_stranger') ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO agents (id, owner_id, name, api_key_hash, status) VALUES
      (${AGENT}, ${OWNER}, 'OauthTestOne', 'x1', 'active'),
      (${OTHER_AGENT}, ${STRANGER}, 'OauthTestTwo', 'x2', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
});

afterAll(async () => {
  if (clients.length) {
    await sql`DELETE FROM oauth_tokens WHERE client_id IN ${sql(clients)}`;
    await sql`DELETE FROM oauth_clients WHERE id IN ${sql(clients)}`;
  }
  await sql`DELETE FROM agents WHERE id IN (${AGENT}, ${OTHER_AGENT})`;
  await sql`DELETE FROM users WHERE id IN (${OWNER}, ${STRANGER})`;
});

describe("discovery and registration", () => {
  it("serves protected resource metadata that names this server", async () => {
    const r = await oauthRouter.request(`${BASE}/.well-known/oauth-protected-resource/mcp`);
    const m = await r.json() as { resource: string; authorization_servers: string[] };
    expect(m.resource).toBe(`${BASE}/mcp`);
    expect(m.authorization_servers[0]).toBe(BASE);
  });

  it("advertises S256 PKCE, public clients and a registration endpoint", async () => {
    const r = await oauthRouter.request(`${BASE}/.well-known/oauth-authorization-server`);
    const m = await r.json() as { code_challenge_methods_supported: string[]; token_endpoint_auth_methods_supported: string[]; registration_endpoint: string };
    expect(m.code_challenge_methods_supported).toContain("S256");
    expect(m.token_endpoint_auth_methods_supported).toContain("none");
    expect(m.registration_endpoint).toBe(`${BASE}/oauth/register`);
  });

  it("rejects a plain http redirect that isn't loopback", async () => {
    expect((await register(["http://evil.example/cb"])).status).toBe(400);
  });

  it("accepts https and loopback redirects", async () => {
    expect((await register([REDIRECT, "http://127.0.0.1/callback"])).status).toBe(201);
  });

  it("matches loopback redirects on any port, and nothing else loosely", () => {
    expect(redirectAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:53121/callback")).toBe(true);
    expect(redirectAllowed(["http://localhost/callback"], "http://localhost:3118/callback")).toBe(true);
    expect(redirectAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:53121/other")).toBe(false);
    expect(redirectAllowed([REDIRECT], "https://claude.ai/api/mcp/auth_callback/x")).toBe(false);
  });
});

describe("authorize", () => {
  it("refuses an unknown client without redirecting", async () => {
    const r = await authorize("fmc_00000000000000000000000000000000", pkce().challenge);
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
  });

  it("refuses an unregistered redirect without redirecting", async () => {
    const { clientId } = await register([REDIRECT]);
    const r = await authorize(clientId, pkce().challenge, "https://evil.example/cb");
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
  });

  it("sends a valid request to the consent page", async () => {
    const { clientId } = await register([REDIRECT]);
    const r = await authorize(clientId, pkce().challenge);
    expect(r.status).toBe(302);
    expect(r.headers.get("location") ?? "").toContain("/connect?request=");
  });
});

describe("approve and tokens", () => {
  it("won't let someone bind another person's agent", async () => {
    const { clientId } = await register([REDIRECT]);
    const requestId = await requestIdFrom(await authorize(clientId, pkce().challenge));
    const r = await approve(requestId, OWNER, { agentId: OTHER_AGENT });
    expect(r.status).toBe(403);
  });

  it("issues tokens for the right verifier, and the access token plays as the agent", async () => {
    const { tok, tokens } = await signIn();
    expect(tok.status).toBe(200);
    expect(tokens.access_token.startsWith("fma_")).toBe(true);
    const agent = await verifyAccessToken(tokens.access_token);
    expect(agent?.id).toBe(AGENT);
  });

  it("rejects a wrong PKCE verifier", async () => {
    const { clientId } = await register([REDIRECT]);
    const { challenge } = pkce();
    const requestId = await requestIdFrom(await authorize(clientId, challenge));
    const { redirectTo } = await (await approve(requestId, OWNER, { agentId: AGENT })).json() as { redirectTo: string };
    const code = new URL(redirectTo).searchParams.get("code") ?? "";
    const r = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pkce().verifier });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("uses a code only once", async () => {
    const { clientId, verifier, code } = await signIn();
    const again = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
    expect(((await again.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("rotates refresh tokens: the old one stops working", async () => {
    const { clientId, tokens } = await signIn();
    const first = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
    expect(first.status).toBe(200);
    const second = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId });
    expect(((await second.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("answers an unknown client at the token endpoint with invalid_client", async () => {
    const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: "x", client_id: "fmc_00000000000000000000000000000000" });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toBe("invalid_client");
  });
});

describe("the MCP endpoint", () => {
  const init = (auth?: string) => mcpRouter.request(`${BASE}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
  });

  it("answers an app with no sign-in with 401 and a pointer to sign in", async () => {
    const r = await init();
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate") ?? "").toContain("resource_metadata=");
  });

  it("lets a signed-in app in, speaking the protocol version it asked for", async () => {
    const { tokens } = await signIn();
    const r = await init(tokens.access_token);
    expect(r.status).toBe(200);
    const body = await r.json() as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe("2025-06-18");
  });

  it("answers GET with 405, since there is no server stream", async () => {
    expect((await mcpRouter.request(`${BASE}/`)).status).toBe(405);
  });
});
