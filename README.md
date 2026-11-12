# British Auction RFQ System

A simplified RFQ (Request for Quotation) system with **British Auction** bidding.
Suppliers compete by submitting progressively lower quotes. If qualifying activity
happens in the last **X** minutes before close, the close time extends by **Y** minutes,
but never beyond a hard **Forced Close Time**.

- Design doc: [`docs/HLD.md`](docs/HLD.md) (architecture, ER diagram, sequence diagrams)
- Schema: [`db/schema.sql`](db/schema.sql)

## Features

- Create an RFQ with British Auction config (start, close, forced close, pickup date, X, Y, trigger type)
- Three extension triggers:
  - **ANY_BID**: any bid in the last X minutes
  - **ANY_RANK_CHANGE**: any change in supplier ranking in the last X minutes
  - **L1_CHANGE**: the lowest bidder changes in the last X minutes
- Extension never exceeds the forced close time (enforced in code **and** by a DB CHECK constraint)
- Auction listing: lowest bid, current close, forced close, status (Active / Closed / Force Closed)
- Auction details: ranked bids (L1, L2, ...), full quote breakdown, config, live countdown,
  activity log with the reason for every extension
- Concurrency-safe bidding (row lock per RFQ)

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + React Router (plain CSS) |
| Backend | Node.js 20.6+ + Express |
| Database | PostgreSQL 12+ |
| Live updates | Polling (3s details, 5s list) |

## Prerequisites

- Node.js **20.6 or newer** (uses `--env-file`)
- PostgreSQL **12 or newer** (uses a generated column)

## Setup

```bash
# 1. Database
createdb rfq
psql rfq -f db/schema.sql          # tables, constraints, ranking view, seed data

# 2. Backend
cd backend
npm install
cp .env.example .env               # adjust DATABASE_URL if needed
npm start                          # http://localhost:4000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

Seed data creates: **Buyer Co**, **Supplier A/B/C**, and one sample RFQ (`RFQ-001`).

## Using the app

There is no real login. Use the **"Acting as"** dropdown in the top-right to switch between
the buyer and suppliers. The buyer can create RFQs, and suppliers can bid.

### 2-minute demo walkthrough

1. Switch to **Buyer Co**, then **Create RFQ**: close in **3 min**, forced close in **8 min**,
   **X = 2**, **Y = 1**, trigger **L1_CHANGE**.
2. Switch to **Supplier A** and place a bid. It's outside the trigger window, so there is no extension.
3. Wait until the countdown turns orange ("in trigger window"). Switch to **Supplier B** and underbid A.
   The log shows `TIME_EXTENDED: L1 changed from Supplier A to Supplier B`, the close time moves,
   and the "extended" tag appears.
4. Keep trading L1 until the cap is reached. The log says `(capped at forced close time)`
   and the status ends as **Force Closed**.
5. Try bidding after close. The form is hidden and the API returns 409.
6. Repeat with `ANY_BID` and `ANY_RANK_CHANGE` to compare the triggers.

## API

All endpoints are under `/api`. Pass `x-user-id: <id>` (the frontend does this automatically).

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| GET | `/users` | none | Users for the role switcher |
| POST | `/rfqs` | BUYER | Create RFQ |
| GET | `/rfqs` | any | Auction listing |
| GET | `/rfqs/:id` | any | Details: config, ranking, bids, activity log, `server_time` |
| POST | `/rfqs/:id/bids` | SUPPLIER | Submit a bid |

Error codes: 400 validation, 401/403 auth, 404 not found, 409 state conflict
(auction not active, duplicate reference ID).

Example:

```bash
curl -X POST localhost:4000/api/rfqs/1/bids \
  -H "x-user-id: 2" -H "Content-Type: application/json" \
  -d '{"carrier_name":"Maersk","freight_charges":1000,"origin_charges":200,
       "destination_charges":150,"transit_time_days":18,"quote_valid_until":"2030-12-31"}'
```

## Tests

```bash
cd backend
npm test                           # unit tests: pure auction rules, no DB needed

# Integration tests need a SEPARATE database (they truncate tables)
createdb rfq_test
psql rfq_test -f ../db/schema.sql
cp .env.test.example .env.test
npm run test:integration
```

Integration tests cover: window boundaries, all three triggers, forced-close capping,
the DB CHECK constraint, rejected bids (closed / not started / non-improving),
rollback on rejection, and concurrent bids.

## How the extension logic works

On every bid, inside **one transaction** that first locks the RFQ row (`SELECT ... FOR UPDATE`):

1. Reject if the auction isn't active (`now < start` or `now >= bid_close_time`)
2. Read the ranking **before** the bid
3. Reject if the bid doesn't beat the supplier's own previous best
4. Insert the bid and log `BID_PLACED`
5. Read the ranking **after** the bid
6. If `now` is within `[close - X, close)` and the trigger condition is met:
   `new_close = min(close + Y, forced_close)`. If it moved, update the RFQ and log
   `TIME_EXTENDED` with the reason

Auction status is **computed on read** from timestamps, so no background job is needed.

## Assumptions

| Topic | Decision |
|---|---|
| Extension base | Y is added to the **current close time**, not to "now" (matches 6:00 → 6:05) |
| Window | `[close − X, close)`: start inclusive, end exclusive |
| Ranking | Per supplier by their **lowest total**; ties go to the earlier bid |
| Total price | freight + origin + destination |
| Bid rule | A supplier's new bid must be lower than their own current best |
| ANY_RANK_CHANGE | Fires when the ordered supplier list changes, including a new supplier joining |
| L1_CHANGE | Fires when the L1 *supplier* changes (first-ever bid counts; improving your own L1 does not) |
| Forced Close vs Closed | **Force Closed** = the auction reached its hard cap. **Closed** = it ended before the cap |
| Currency | Single implicit currency |
| Auth | Simplified header + role switcher, not production auth |

## Known limitations

- Mocked authentication and no per-RFQ supplier invitations
- Polling (up to 3s stale) instead of WebSockets/SSE
- No award/winner selection workflow or notifications
- Quote validity is stored and shown but not enforced
- `AUCTION_CLOSED` / `AUCTION_FORCE_CLOSED` log types exist in the enum but aren't written
  (closing is implicit)

## Project structure

```
db/          schema.sql
backend/     Express API: src/ (engine, services, routes), test/ (unit), integration/ (DB tests)
frontend/    React SPA: src/pages, src/components
docs/        HLD.md
```
