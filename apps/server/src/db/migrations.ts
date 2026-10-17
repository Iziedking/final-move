export const migrations: { name: string; sql: string }[] = [
  {
    name: "001_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id          text PRIMARY KEY,          -- "u_" + nanoid
        x_id        text UNIQUE,
        handle      text NOT NULL,
        avatar      text,
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS agents (
        id          text PRIMARY KEY,          -- "ag_" + nanoid
        owner_id    text NOT NULL REFERENCES users(id),
        name        text NOT NULL UNIQUE,
        api_key_hash text NOT NULL,
        model_note  text,
        status      text NOT NULL DEFAULT 'active', -- active | suspended
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS wallets (
        id              text PRIMARY KEY,      -- "w_" + nanoid
        owner_type      text NOT NULL,         -- user | agent | bot | operator
        owner_id        text NOT NULL,
        circle_wallet_id text NOT NULL UNIQUE,
        address         text NOT NULL,
        chain           text NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS wallets_owner ON wallets(owner_type, owner_id);
      CREATE INDEX IF NOT EXISTS wallets_address ON wallets(address);

      CREATE TABLE IF NOT EXISTS games (
        id              text PRIMARY KEY,      -- "g_" + nanoid
        white_id        text NOT NULL,         -- user/agent/bot id
        white_kind      text NOT NULL,         -- user | agent | bot
        black_id        text NOT NULL,
        black_kind      text NOT NULL,
        class           text NOT NULL,         -- open | human
        time_control    text NOT NULL,         -- 3+2 | 5+3 | 10+5
        base_sec        integer NOT NULL,
        inc_sec         integer NOT NULL,
        status          text NOT NULL DEFAULT 'waiting', -- waiting|live|ended|aborted
        result          text,                  -- white|black|draw|aborted
        reason          text,
        pgn             text,
        chain_game_id   text,                  -- bytes32 on-chain id
        escrow_match_id text,
        white_address   text NOT NULL,
        black_address   text NOT NULL,
        white_wallet_id text NOT NULL,
        black_wallet_id text NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        started_at      timestamptz,
        ended_at        timestamptz
      );
      CREATE INDEX IF NOT EXISTS games_status ON games(status);

      CREATE TABLE IF NOT EXISTS moves (
        id            text PRIMARY KEY,        -- "mv_" + nanoid
        game_id       text NOT NULL REFERENCES games(id),
        ply           integer NOT NULL,
        uci           text NOT NULL,
        san           text,
        fen_after     text NOT NULL,
        clock_w_ms    integer NOT NULL,
        clock_b_ms    integer NOT NULL,
        state         text NOT NULL DEFAULT 'queued',
        circle_tx_id  text,
        tx_hash       text,
        block         bigint,
        submitted_at  timestamptz,
        sent_at       timestamptz,
        complete_at   timestamptz,
        final_at      timestamptz,
        relayed       boolean NOT NULL DEFAULT false,
        retry_count   integer NOT NULL DEFAULT 0,
        created_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE(game_id, ply)
      );
      CREATE INDEX IF NOT EXISTS moves_game_state ON moves(game_id, state);
      CREATE INDEX IF NOT EXISTS moves_circle_tx ON moves(circle_tx_id);
      CREATE INDEX IF NOT EXISTS moves_tx_hash ON moves(tx_hash);

      CREATE TABLE IF NOT EXISTS matches (
        id              text PRIMARY KEY,      -- on-chain matchId bytes32
        game_id         text NOT NULL REFERENCES games(id),
        amount_usdc6    bigint NOT NULL,
        fund_deadline   timestamptz NOT NULL,
        white_deposited boolean NOT NULL DEFAULT false,
        black_deposited boolean NOT NULL DEFAULT false,
        status          text NOT NULL DEFAULT 'open', -- open|funded|settled|cancelled|refunded
        created_at      timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS tournaments (
        id          text PRIMARY KEY,
        tid_onchain text,
        name        text NOT NULL,
        class       text NOT NULL DEFAULT 'open',
        time_control text NOT NULL DEFAULT '5+3',
        entry_fee_usdc6 bigint NOT NULL DEFAULT 0,
        prize_pool_usdc6 bigint NOT NULL DEFAULT 0,
        reg_close   timestamptz NOT NULL,
        starts_at   timestamptz NOT NULL,
        status      text NOT NULL DEFAULT 'upcoming', -- upcoming|open|running|done|cancelled
        bracket_json text,
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS entries (
        tournament_id text NOT NULL REFERENCES tournaments(id),
        player_id     text NOT NULL,
        player_kind   text NOT NULL,
        registered_at timestamptz NOT NULL DEFAULT now(),
        placement     integer,
        PRIMARY KEY(tournament_id, player_id)
      );

      CREATE TABLE IF NOT EXISTS ratings (
        subject_id    text NOT NULL,
        subject_kind  text NOT NULL,
        class         text NOT NULL,
        time_control  text NOT NULL,
        mu            double precision NOT NULL DEFAULT 25.0,
        sigma         double precision NOT NULL DEFAULT 8.333,
        games         integer NOT NULL DEFAULT 0,
        updated_at    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(subject_id, class, time_control)
      );

      CREATE TABLE IF NOT EXISTS chain_events (
        id            bigserial PRIMARY KEY,
        tx_hash       text NOT NULL,
        log_index     integer NOT NULL,
        block_number  bigint NOT NULL,
        block_time    timestamptz,
        contract      text NOT NULL,
        event_name    text NOT NULL,
        args_json     text NOT NULL,
        processed_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS chain_events_block ON chain_events(block_number);
      CREATE INDEX IF NOT EXISTS chain_events_event ON chain_events(event_name);

      CREATE TABLE IF NOT EXISTS topups (
        id              bigserial PRIMARY KEY,
        wallet_id       text NOT NULL,
        amount_usdc6    bigint NOT NULL,
        circle_tx_id    text,
        tx_hash         text,
        created_at      timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS indexer_state (
        key   text PRIMARY KEY,
        value text NOT NULL
      );
    `,
  },
  {
    name: "002_stage4",
    sql: `
      -- Fair-play flags column (JSONB, nullable)
      ALTER TABLE games ADD COLUMN IF NOT EXISTS fair_play_flags jsonb;

      -- Matchmaking: index on (class, time_control, status) for fast queue lookup
      CREATE INDEX IF NOT EXISTS games_class_tc_status
        ON games(class, time_control, status);

      -- Rematch offers: keyed by original game_id
      CREATE TABLE IF NOT EXISTS rematch_offers (
        game_id       text PRIMARY KEY REFERENCES games(id),
        offered_by    text NOT NULL,
        expires_at    timestamptz NOT NULL DEFAULT (now() + interval '2 minutes'),
        accepted      boolean NOT NULL DEFAULT false
      );
    `,
  },
  {
    name: "003_stage5",
    sql: `
      -- Fast API key lookup index
      CREATE INDEX IF NOT EXISTS agents_api_key_hash ON agents(api_key_hash);

      -- Agent arena: track active arena sessions
      CREATE TABLE IF NOT EXISTS arena_sessions (
        id           text PRIMARY KEY,
        agent1_id    text NOT NULL,
        agent2_id    text NOT NULL,
        game_id      text REFERENCES games(id),
        status       text NOT NULL DEFAULT 'pending', -- pending|running|done
        created_at   timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "004_stage6",
    sql: `
      -- Stake offers: created when a player wants to play with stakes
      CREATE TABLE IF NOT EXISTS stake_offers (
        id              text PRIMARY KEY,        -- "so_" + nanoid(8)
        game_id         text REFERENCES games(id),
        match_id        text,                    -- on-chain bytes32 matchId (set after open())
        amount_usdc6    bigint NOT NULL,         -- stake per player in USDC 6-dec units
        white_id        text NOT NULL,
        black_id        text NOT NULL,
        white_approved  boolean NOT NULL DEFAULT false,
        black_approved  boolean NOT NULL DEFAULT false,
        status          text NOT NULL DEFAULT 'pending', -- pending|open|funded|settled|cancelled|refunded|timeout
        fund_deadline   timestamptz,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS stake_offers_game ON stake_offers(game_id);
      CREATE INDEX IF NOT EXISTS stake_offers_status ON stake_offers(status);

      -- Track USDC approvals and deposits per player per match
      CREATE TABLE IF NOT EXISTS stake_deposits (
        id              text PRIMARY KEY,        -- "sd_" + nanoid(8)
        stake_offer_id  text NOT NULL REFERENCES stake_offers(id),
        player_id       text NOT NULL,
        circle_tx_id    text,
        tx_hash         text,
        state           text NOT NULL DEFAULT 'pending', -- pending|submitted|confirmed|failed
        created_at      timestamptz NOT NULL DEFAULT now(),
        UNIQUE(stake_offer_id, player_id)
      );

      -- Add staked flag + stake_offer_id to games
      ALTER TABLE games ADD COLUMN IF NOT EXISTS staked boolean NOT NULL DEFAULT false;
      ALTER TABLE games ADD COLUMN IF NOT EXISTS stake_offer_id text;
    `,
  },
  {
    name: "005_stage7",
    sql: `
      -- Link bracket games to their tournament
      CREATE TABLE IF NOT EXISTS tournament_games (
        tournament_id  text NOT NULL REFERENCES tournaments(id),
        game_id        text NOT NULL REFERENCES games(id),
        round          integer NOT NULL,
        match_index    integer NOT NULL,
        white_player_id text NOT NULL,
        black_player_id text NOT NULL,
        winner_id      text,
        created_at     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tournament_id, round, match_index)
      );
      CREATE INDEX IF NOT EXISTS tg_game ON tournament_games(game_id);
      CREATE INDEX IF NOT EXISTS tg_tournament ON tournament_games(tournament_id);

      -- Add placement + prize columns to entries
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS prize_usdc6 bigint NOT NULL DEFAULT 0;
      ALTER TABLE entries ADD COLUMN IF NOT EXISTS prize_tx_hash text;

      -- Add chain tid to tournaments
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS chain_tid text;

      -- Track treasury funding tx
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS fund_tx_hash text;
    `,
  },
  {
    name: "006_stage8",
    sql: `
      -- Player streaks (current_streak > 0 = win streak, < 0 = loss streak)
      CREATE TABLE IF NOT EXISTS streaks (
        subject_id     text NOT NULL,
        subject_kind   text NOT NULL,
        class          text NOT NULL,
        current_streak integer NOT NULL DEFAULT 0,
        best_streak    integer NOT NULL DEFAULT 0,
        updated_at     timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(subject_id, class)
      );

      -- Titles earned (first to N wins, champion etc.)
      CREATE TABLE IF NOT EXISTS titles (
        subject_id   text NOT NULL,
        title        text NOT NULL,
        earned_at    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(subject_id, title)
      );

      -- Humans vs Machines running tally (one row, upserted)
      CREATE TABLE IF NOT EXISTS hvm_scoreboard (
        id              integer PRIMARY KEY DEFAULT 1,
        human_wins      integer NOT NULL DEFAULT 0,
        machine_wins    integer NOT NULL DEFAULT 0,
        draws           integer NOT NULL DEFAULT 0,
        updated_at      timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO hvm_scoreboard (id) VALUES (1) ON CONFLICT DO NOTHING;

      -- Index for fast game lookup by player
      CREATE INDEX IF NOT EXISTS games_white ON games(white_id);
      CREATE INDEX IF NOT EXISTS games_black ON games(black_id);
    `,
  },
  {
    name: "007_qa_round1_repair",
    sql: `
      -- (a) Fix subject_kind on ratings rows written with the wrong kind.
      UPDATE ratings
        SET subject_kind =
          CASE
            WHEN subject_id LIKE 'bot_%' THEN 'bot'
            WHEN subject_id LIKE 'ag_%'  THEN 'agent'
            ELSE 'user'
          END
        WHERE subject_kind <> (
          CASE
            WHEN subject_id LIKE 'bot_%' THEN 'bot'
            WHEN subject_id LIKE 'ag_%'  THEN 'agent'
            ELSE 'user'
          END
        );

      -- (b) Promote moves stuck at 'complete' whose Move event is in chain_events.
      --     Original strategy: LIKE match on the raw tx_hash or a loose chain_game_id
      --     substring match.  (This is the version that ran on all existing databases.)
      UPDATE moves m
        SET state    = 'final',
            block    = ce.block_number,
            final_at = ce.block_time
        FROM chain_events ce
        WHERE m.state = 'complete'
          AND ce.event_name = 'Move'
          AND (
            (m.tx_hash IS NOT NULL AND m.tx_hash = ce.tx_hash)
            OR
            (m.tx_hash IS NULL AND ce.args_json LIKE '%' || ltrim(
              COALESCE((SELECT g.chain_game_id FROM games g WHERE g.id = m.game_id LIMIT 1), ''), '0x'
            ) || '%')
          );

      -- (c) Rebuild hvm_scoreboard.
      INSERT INTO hvm_scoreboard (id, human_wins, machine_wins, draws, updated_at)
        SELECT
          1,
          COUNT(*) FILTER (
            WHERE (white_kind = 'user'  AND result = 'white')
               OR (black_kind = 'user'  AND result = 'black')
          ),
          COUNT(*) FILTER (
            WHERE (white_kind <> 'user' AND result = 'white')
               OR (black_kind <> 'user' AND result = 'black')
          ),
          COUNT(*) FILTER (WHERE result = 'draw'),
          now()
        FROM games
        WHERE status = 'ended'
          AND result <> 'aborted'
          AND (white_kind = 'user') <> (black_kind = 'user')
          AND white_id NOT LIKE 'guest%'
          AND black_id NOT LIKE 'guest%'
      ON CONFLICT (id) DO UPDATE
        SET human_wins   = EXCLUDED.human_wins,
            machine_wins = EXCLUDED.machine_wins,
            draws        = EXCLUDED.draws,
            updated_at   = EXCLUDED.updated_at;
    `,
  },
  {
    name: "008_qa_round2_repair",
    sql: `
      -- Tighten the move-promotion from 'complete' → 'final'.
      -- Migration 007 used a loose LIKE match on chain_game_id that could
      -- promote the wrong move if two games share a similar id prefix.
      -- This migration:
      --   (a) Reverts any wrong promotions (moves whose tx_hash does not appear
      --       in chain_events after the tighter match).
      --   (b) Re-runs the promotion with an unambiguous (gameId, ply) match using
      --       the topics array stored in args_json.
      --
      -- Idempotent: re-running is safe; already-correct rows are unchanged.

      -- Step 1: Revert false promotions — 'final' moves with no matching event.
      DO $$
      DECLARE
        reverted integer;
      BEGIN
        WITH wrong AS (
          SELECT m.id
          FROM moves m
          WHERE m.state = 'final'
            AND m.tx_hash IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM chain_events ce
              WHERE ce.event_name = 'Move'
                AND ce.tx_hash = m.tx_hash
            )
            AND NOT EXISTS (
              SELECT 1 FROM chain_events ce
              JOIN games g ON g.id = m.game_id
              WHERE ce.event_name = 'Move'
                AND ce.args_json::jsonb #>> '{topics,1}' = g.chain_game_id
                AND lpad(to_hex(m.ply), 64, '0') =
                      lpad(ltrim(ce.args_json::jsonb #>> '{topics,2}', '0x'), 64, '0')
            )
        )
        UPDATE moves SET state = 'complete', block = NULL, final_at = NULL
        WHERE id IN (SELECT id FROM wrong);
        GET DIAGNOSTICS reverted = ROW_COUNT;
        RAISE NOTICE '[008] reverted % wrong promotion(s)', reverted;
      END $$;

      -- Step 2: Re-promote with the tight (gameId, ply) match.
      -- Note: Postgres UPDATE … FROM requires listing all tables in FROM clause;
      -- JOIN inside FROM is not valid here. Use a comma-separated FROM list with
      -- WHERE conditions instead.
      DO $$
      DECLARE
        promoted integer;
      BEGIN
        UPDATE moves m
          SET state    = 'final',
              block    = ce.block_number,
              final_at = COALESCE(ce.block_time, now()),
              tx_hash  = COALESCE(m.tx_hash, ce.tx_hash)
          FROM chain_events ce, games g
          WHERE g.id = m.game_id
            AND m.state = 'complete'
            AND ce.event_name = 'Move'
            AND (
              (m.tx_hash IS NOT NULL AND m.tx_hash = ce.tx_hash)
              OR (
                ce.args_json::jsonb #>> '{topics,1}' = g.chain_game_id
                AND lpad(to_hex(m.ply), 64, '0') =
                      lpad(ltrim(ce.args_json::jsonb #>> '{topics,2}', '0x'), 64, '0')
              )
            );
        GET DIAGNOSTICS promoted = ROW_COUNT;
        RAISE NOTICE '[008] promoted % move(s) to final', promoted;
      END $$;
    `,
  },

  // ── 009 — Add chain_game_id column to chain_events for exact replay matching
  //         Migration 007/008 extracts the game id from args_json via jsonb path
  //         which is slow and brittle (LIKE-based in older code could mix games).
  //         This migration adds a dedicated indexed column and back-fills it.
  //
  //         Indexer (QA Round 4A) now writes chain_game_id on every insert.
  //         The replay query can then use an exact equality match.
  {
    name: "009_chain_events_chain_game_id",
    sql: `
      ALTER TABLE chain_events
        ADD COLUMN IF NOT EXISTS chain_game_id text;

      -- Back-fill from args_json topic[1] for Move/GameCreated/GameEnded events
      UPDATE chain_events
        SET chain_game_id = args_json::jsonb #>> '{topics,1}'
        WHERE chain_game_id IS NULL
          AND event_name IN ('Move','GameCreated','GameEnded')
          AND args_json IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_chain_events_chain_game_id
        ON chain_events (chain_game_id)
        WHERE chain_game_id IS NOT NULL;

      RAISE NOTICE '[009] back-filled chain_game_id on chain_events';
    `,
  },
];
