/**
 * Sandbox preview proxy (zero deps) — port 5173
 *   /v1/* /ws /mcp/* /health  → API server :3001  (HTTP + WS upgrade)
 *   everything else            → Next.js    :3000  (HTTP + HMR WS)
 */
import http from "http";
import net  from "net";

const LISTEN  = parseInt(process.env.PROXY_PORT ?? "5173", 10);
const API     = parseInt(process.env.API_PORT   ?? "3001",  10);
const WEB     = parseInt(process.env.WEB_PORT   ?? "3000",  10);

const API_RE = /^\/(v1|ws|mcp|health)(\/|$|\?)/;

function proxyHttp(req, res, port) {
  const opts = {
    hostname: "127.0.0.1", port,
    path: req.url, method: req.method, headers: req.headers,
  };
  const prx = http.request(opts, (upstream) => {
    res.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(res);
  });
  prx.on("error", () => { try { res.writeHead(502); res.end("upstream error"); } catch {} });
  req.pipe(prx);
}

function proxyWs(req, socket, head, port) {
  const upstream = net.createConnection(port, "127.0.0.1", () => {
    // Reconstruct the HTTP upgrade request
    const headers = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headers.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(headers.join("\r\n") + "\r\n\r\n");
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error",   () => upstream.destroy());
}

const server = http.createServer((req, res) => {
  const port = API_RE.test(req.url ?? "/") ? API : WEB;
  proxyHttp(req, res, port);
});

server.on("upgrade", (req, socket, head) => {
  const port = API_RE.test(req.url ?? "/") ? API : WEB;
  proxyWs(req, socket, head, port);
});

server.listen(LISTEN, () =>
  console.log(`[proxy] :${LISTEN} → api:${API} / web:${WEB}`)
);
