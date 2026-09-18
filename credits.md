# Peanut Game Credits API

Minimal reference backend for the credits system. Stores balances in
`credits-db.json` (created automatically), keyed by an anonymous
per-device ID the frontend sends as the `X-Device-Id` header.

## Run locally

    npm install
    npm start

Server listens on port 4000 by default (override with `PORT=xxxx npm start`).

## Point the frontend at it

In `js/credits_manager.js`, set:

    this.apiBase = "https://your-deployed-api.example.com/api/credits";

(or `"http://localhost:4000/api/credits"` while testing locally).

## Before going live, you should

- Replace the hardcoded `VALID_CODES` map with codes generated per
  real purchase/receipt, stored in a real database, and marked "used"
  atomically on redemption.
- Lock down CORS to your actual frontend domain instead of allowing all
  origins (`cors()` with no options allows any site to call this API).
- Add rate limiting per device ID on `/use`, `/redeem`, `/milestone`,
  and `/score-bonus` to prevent abuse/scripted farming.
- Sanity-check that `score` in `/score-bonus` is plausible for how long
  the round actually ran, rather than trusting the client's number
  outright.
- Serve over HTTPS.
- Replace the JSON-file store with a real database (Postgres, SQLite,
  etc.) -- the file store is fine for testing, not for concurrent
  production traffic.
