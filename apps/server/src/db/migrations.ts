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
];
