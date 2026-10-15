#!/usr/bin/env bash
# start-local.sh — start the full Final Move stack locally (testnet)
#
# Usage:
#   ./scripts/start-local.sh
#
# Starts: Postgres + Redis (Docker), server (:3001), web (:3000)
# Stops everything on Ctrl-C.
#
# Prerequisites:
#   • Docker running
#   • .env populated (copy .env.example, fill in keys + addresses)
#   • bun installed (https://bun.sh)
#
# First-time only:
#   bun install
#   docker compose up -d   (or the script does it for you)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[start]${NC} $*"; }
ok()    { echo -e "${GREEN}[start]${NC} $*"; }
warn()  { echo -e "${YELLOW}[start]${NC} $*"; }
die()   { echo -e "${RED}[start]${NC} $*"; exit 1; }

# ── Pre-checks ────────────────────────────────────────────────────────────────
command -v bun    >/dev/null 2>&1 || die "bun not found — install from https://bun.sh"
command -v docker >/dev/null 2>&1 || die "docker not found"

[[ -f .env ]] || die ".env not found — copy .env.example and fill in credentials"
grep -q "CIRCLE_API_KEY=" .env || warn ".env may be incomplete — check CIRCLE_API_KEY"

# ── Install deps if needed ────────────────────────────────────────────────────
if [[ ! -d node_modules ]]; then
  info "Installing dependencies…"
  bun install
fi

# ── Start Docker services ─────────────────────────────────────────────────────
info "Starting Postgres + Redis…"
docker compose up -d --wait 2>/dev/null || docker-compose up -d
sleep 2

# Verify DB is reachable
DB_URL=$(grep DATABASE_URL .env | cut -d= -f2-)
if docker compose exec postgres pg_isready -q 2>/dev/null || \
   docker-compose exec postgres pg_isready -q 2>/dev/null; then
  ok "Postgres ready"
else
  warn "Could not verify Postgres — proceeding anyway"
fi

# ── Cleanup on Ctrl-C ─────────────────────────────────────────────────────────
SERVER_PID=""
WEB_PID=""

cleanup() {
  echo ""
  info "Shutting down…"
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
  [[ -n "$WEB_PID"    ]] && kill "$WEB_PID"    2>/dev/null || true
  # Leave Docker running (faster restart); pass --full to also stop Docker
  if [[ "${1:-}" == "--full" ]]; then
    docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true
  fi
  ok "Done."
}
trap 'cleanup' INT TERM

# ── Start server with restart loop ───────────────────────────────────────────
# The server exits with code 1 on uncaughtException (ERR_STREAM_ALREADY_FINISHED
# from a double WS upgrade, or any other fatal). The loop restarts it automatically
# so one bad WebSocket connection can no longer take the service down.
info "Starting server on :3001 (with restart loop)…"
(
  while true; do
    bun --env-file="$REPO_ROOT/.env" run "$REPO_ROOT/apps/server/src/index.ts" || true
    warn "Server exited — restarting in 2 s…"
    sleep 2
  done
) &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 20); do
  sleep 1
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
    ok "Server ready  →  http://localhost:3001"
    break
  fi
  [[ $i -eq 20 ]] && die "Server failed to start — check logs above"
done

# ── Start web ─────────────────────────────────────────────────────────────────
info "Starting web on :3000…"
cd apps/web
bun run dev &
WEB_PID=$!
cd "$REPO_ROOT"

# Wait for web to be ready
for i in $(seq 1 30); do
  sleep 1
  if curl -sf http://localhost:3000 >/dev/null 2>&1; then
    ok "Web ready  →  http://localhost:3000"
    break
  fi
  [[ $i -eq 30 ]] && warn "Web may still be compiling — check http://localhost:3000"
done

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Final Move running on Arc Testnet (chain 5042002)${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Web app:     ${CYAN}http://localhost:3000${NC}"
echo -e "  API server:  ${CYAN}http://localhost:3001${NC}"
echo -e "  Health:      ${CYAN}http://localhost:3001/health${NC}"
echo -e "  Explorer:    ${CYAN}https://explorer.testnet.arc.io${NC}"
echo ""
echo -e "  Press ${YELLOW}Ctrl-C${NC} to stop."
echo ""

# ── Keep alive ────────────────────────────────────────────────────────────────
wait
