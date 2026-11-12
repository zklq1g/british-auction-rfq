-- =========================================================
-- British Auction RFQ: schema
-- =========================================================

-- ---------- Enums ----------
CREATE TYPE user_role AS ENUM ('BUYER', 'SUPPLIER');

CREATE TYPE extension_trigger_type AS ENUM (
  'ANY_BID',          -- bid received in last X minutes
  'ANY_RANK_CHANGE',  -- any supplier rank change in last X minutes
  'L1_CHANGE'         -- lowest bidder changed in last X minutes
);

CREATE TYPE activity_type AS ENUM (
  'RFQ_CREATED',
  'BID_PLACED',
  'TIME_EXTENDED',
  'AUCTION_CLOSED',
  'AUCTION_FORCE_CLOSED'
);

-- ---------- users ----------
CREATE TABLE users (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  email       VARCHAR(255) UNIQUE,
  role        user_role NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- rfqs ----------
CREATE TABLE rfqs (
  id                        BIGSERIAL PRIMARY KEY,
  reference_id              VARCHAR(50)  NOT NULL UNIQUE,
  name                      VARCHAR(200) NOT NULL,

  -- Timing
  bid_start_time            TIMESTAMPTZ NOT NULL,
  original_close_time       TIMESTAMPTZ NOT NULL,   -- never changes
  bid_close_time            TIMESTAMPTZ NOT NULL,   -- current close time, moves on extension
  forced_close_time         TIMESTAMPTZ NOT NULL,   -- hard cap
  pickup_date               DATE NOT NULL,

  -- British auction config
  is_british_auction        BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_window_minutes    INT NOT NULL,           -- X
  extension_minutes         INT NOT NULL,           -- Y
  extension_trigger         extension_trigger_type NOT NULL,

  created_by                BIGINT NOT NULL REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Validation rules enforced at the DB level
  CONSTRAINT chk_close_after_start
    CHECK (original_close_time > bid_start_time),
  CONSTRAINT chk_forced_after_close
    CHECK (forced_close_time > original_close_time),
  CONSTRAINT chk_current_close_in_range
    CHECK (bid_close_time >= original_close_time
       AND bid_close_time <= forced_close_time),   -- extension never exceeds forced close
  CONSTRAINT chk_x_positive CHECK (trigger_window_minutes > 0),
  CONSTRAINT chk_y_positive CHECK (extension_minutes > 0)
);

CREATE INDEX idx_rfqs_close_time ON rfqs (bid_close_time);

-- ---------- bids ----------
CREATE TABLE bids (
  id                   BIGSERIAL PRIMARY KEY,
  rfq_id               BIGINT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id          BIGINT NOT NULL REFERENCES users(id),

  carrier_name         VARCHAR(150) NOT NULL,
  freight_charges      NUMERIC(14,2) NOT NULL CHECK (freight_charges >= 0),
  origin_charges       NUMERIC(14,2) NOT NULL CHECK (origin_charges >= 0),
  destination_charges  NUMERIC(14,2) NOT NULL CHECK (destination_charges >= 0),
  total_price          NUMERIC(14,2) GENERATED ALWAYS AS
                         (freight_charges + origin_charges + destination_charges) STORED,

  transit_time_days    INT NOT NULL CHECK (transit_time_days > 0),
  quote_valid_until    DATE NOT NULL,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookups for ranking and "lowest bid" queries
CREATE INDEX idx_bids_rfq_price     ON bids (rfq_id, total_price);
CREATE INDEX idx_bids_rfq_supplier  ON bids (rfq_id, supplier_id, total_price);
CREATE INDEX idx_bids_rfq_created   ON bids (rfq_id, created_at);

-- ---------- activity_logs ----------
CREATE TABLE activity_logs (
  id              BIGSERIAL PRIMARY KEY,
  rfq_id          BIGINT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  type            activity_type NOT NULL,
  message         TEXT NOT NULL,                    -- human-readable, shown in UI

  supplier_id     BIGINT REFERENCES users(id),      -- for BID_PLACED
  bid_id          BIGINT REFERENCES bids(id),       -- for BID_PLACED

  old_close_time  TIMESTAMPTZ,                      -- for TIME_EXTENDED
  new_close_time  TIMESTAMPTZ,                      -- for TIME_EXTENDED
  metadata        JSONB,                            -- e.g. {"trigger":"L1_CHANGE","oldL1":3,"newL1":5}

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_rfq_time ON activity_logs (rfq_id, created_at);

-- ---------- ranking view ----------
CREATE VIEW rfq_supplier_ranks AS
WITH best_bids AS (
  SELECT DISTINCT ON (rfq_id, supplier_id)
         rfq_id, supplier_id, id AS bid_id, total_price, created_at
  FROM bids
  ORDER BY rfq_id, supplier_id, total_price ASC, created_at ASC, id ASC
)
SELECT rfq_id,
       supplier_id,
       bid_id,
       total_price,
       created_at,
       ROW_NUMBER() OVER (
         PARTITION BY rfq_id
         ORDER BY total_price ASC, created_at ASC, bid_id ASC
       ) AS rank          -- 1 = L1, 2 = L2, ...
FROM best_bids;

-- ---------- seed data ----------
INSERT INTO users (name, email, role) VALUES
  ('Buyer Co',     'buyer@demo.com',    'BUYER'),
  ('Supplier A',   'a@demo.com',        'SUPPLIER'),
  ('Supplier B',   'b@demo.com',        'SUPPLIER'),
  ('Supplier C',   'c@demo.com',        'SUPPLIER'),
  ('Global Ocean', 'global@demo.com',   'SUPPLIER'),
  ('FastFreight',  'freight@demo.com',  'SUPPLIER');

INSERT INTO rfqs (
  reference_id, name, bid_start_time, original_close_time, bid_close_time,
  forced_close_time, pickup_date, trigger_window_minutes, extension_minutes,
  extension_trigger, created_by
) VALUES (
  'RFQ-001', 'Mumbai to Rotterdam, 20ft container',
  now(), now() + interval '30 minutes', now() + interval '30 minutes',
  now() + interval '60 minutes', current_date + 14,
  10, 5, 'L1_CHANGE', 1
);
