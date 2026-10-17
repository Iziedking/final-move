#!/usr/bin/env python3
"""
Final Move example agent — random mover.
Uses REST long-poll only; no external dependencies.

Usage:
    export FINAL_MOVE_API_KEY=fmk_your_key_here
    export FINAL_MOVE_SERVER=http://localhost:3001
    python agent.py [--time-control 5+3]
"""
import os
import sys
import json
import random
import urllib.request
import urllib.error
import time
import argparse

SERVER   = os.environ.get("FINAL_MOVE_SERVER", "http://localhost:3001")
API_KEY  = os.environ.get("FINAL_MOVE_API_KEY", "")

def req(method: str, path: str, body=None):
    url  = SERVER + path
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(url, data=data, method=method,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type":  "application/json",
        })
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

def get_position(game_id: str):
    return req("GET", f"/v1/games/{game_id}")

def make_move(game_id: str, uci: str):
    return req("POST", f"/v1/games/{game_id}/move", {"uci": uci, "playerId": ""})

def poll_next(wait=25):
    return req("GET", f"/v1/agent/next?wait={wait}")

def queue(time_control: str):
    return req("POST", "/v1/agent/queue", {"timeControl": time_control})

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--time-control", default="5+3")
    args = parser.parse_args()

    if not API_KEY:
        print("ERROR: Set FINAL_MOVE_API_KEY environment variable.")
        sys.exit(1)

    print(f"[random-agent] Joining queue ({args.time_control})...")
    resp = queue(args.time_control)
    print(f"[random-agent] Queue response: {resp}")

    game_id  = None
    my_color = None

    while True:
        evt = poll_next(wait=25)
        t   = evt.get("type")

        if t == "game_start":
            game_id  = evt["gameId"]
            my_color = evt["color"]
            print(f"[random-agent] Game started: {game_id} as {my_color}")

        elif t == "your_turn" and game_id:
            legal = evt.get("moves", [])
            if not legal:
                # Fetch from REST if not in event
                pos   = get_position(game_id)
                legal = pos.get("legalMoves", [])
            if legal:
                uci = random.choice(legal)
                print(f"[random-agent] Playing {uci} (ply {evt.get('ply', '?')})")
                make_move(game_id, uci)
            else:
                print("[random-agent] No legal moves — game probably over")

        elif t == "game_end":
            print(f"[random-agent] Game ended: result={evt.get('result')} reason={evt.get('reason')}")
            print(f"[random-agent] Rating after: {evt.get('ratingAfter')}")
            # Optionally re-queue here for a second game
            break

        elif t == "idle":
            pass  # nothing yet

        else:
            print(f"[random-agent] Event: {t}")

if __name__ == "__main__":
    main()
