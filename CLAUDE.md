# CLAUDE.md

Guidance for Claude Code (or any agent) working in this repo.

## What this project is

Appraiser is a Cloudflare Worker that is a **pure calculator**: given a list of stock tickers,
it returns computed valuation signals. It has no state, no database, no Drive access, and no
IBKR access. It is called by a separate Claude skill (`get-fair-values-v2`, not in this repo)
which owns ticker sourcing and CSV storage. Keep it that way — don't add Drive/IBKR/CSV logic
here even if it would be convenient; that boundary was a deliberate design decision.

## Non-negotiable contract

The consumer (the Claude skill) depends on this exact response shape per ticker:

```json
{ "ticker": "NVDA", "fairValue": 187.32, "wsTarget": 210.5, "wsRating": "Buy",
  "risk": "Medium", "confidence": "High", "warnings": [] }
```

- Field names (`fairValue`, `wsTarget`, `wsRating`, `risk`, `confidence`, `warnings`) are fixed.
  Renaming any of them breaks the skill silently (it just writes empty CSV cells) — if a rename
  is genuinely needed, it must be coordinated with a matching update to `get-fair-values-v2`.
- Every field except `ticker` can be `null`. A ticker Appraiser can't resolve at all still
  returns `200` with all-null fields and an explanatory `warnings` entry — never throw or 4xx
  for a single bad ticker inside a batch. The whole endpoint should only ever 4xx/5xx for
  auth failure or a malformed request body.
- `risk` and `confidence` are always exactly one of `"Low"`, `"Medium"`, `"High"`, or `null`.
  `wsRating` is always exactly one of `"Strong Buy"`, `"Buy"`, `"Hold"`, `"Sell"`,
  `"Strong Sell"`, or `null` — never a raw numeric score or any other string.

## Where things live, and why

- **`src/fmp.ts`** — every FMP call lives here and nowhere else. FMP has changed field names
  and endpoint paths across API versions before; when that happens, this is the only file that
  should need editing. Don't inline `fetch()` calls to FMP anywhere else in the codebase.
- **`src/technical.ts`** — the technical entry signal is intentionally rule-based (SMA50/SMA200
  crossover + RSI thresholds), not an LLM judgment call and not sourced from a third-party
  "technical rating" API. If you're tempted to swap in an external technicals API, don't —
  the whole point of this signal is that it's cheap, deterministic, and doesn't depend on any
  external service beyond raw price history.
- **`src/index.ts`** — orchestration, auth, and the Risk/Confidence bucket math. This math
  mirrors specific thresholds from the `get-fair-values-v2` skill doc (e.g. beta <1.0/1.0–1.5/
  >1.5, analyst spread <15%/15–35%/>35%). If those thresholds ever change, they need to change
  in both places — this file is not the source of truth for the skill's documented rules, it's
  an implementation of them.

## Secrets

`FMP_API_KEY` and `WORKER_SHARED_SECRET` are Cloudflare Worker secrets (`wrangler secret put`),
never committed, never placed in `wrangler.toml`, and never passed in from the Claude side. If
you add any new third-party API key, follow the same pattern — secret, not a `[vars]` entry.

## Before changing FMP field mappings

Two fields in `src/fmp.ts` are marked `// VERIFY` because they were written from best
understanding of FMP's schema without a live test. Don't remove those comments or treat the
current field names as ground truth until they've actually been confirmed against a real API
response — if you're making changes near them, take the opportunity to verify and then remove
the comment.

## Testing changes

There's no CSV or Drive dependency to mock — testing is just:

```bash
npx wrangler dev
curl -X POST http://localhost:8787/calculate \
  -H "Authorization: Bearer <value from .dev_vars>" \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["NVDA", "SOME-DELISTED-TICKER"]}'
```

Always include at least one ticker expected to fail/partial-fail in test payloads — the
`warnings` path is easy to break silently since the happy path doesn't exercise it.

## Deployment

`npx wrangler deploy`. See README.md for the full command list (login, secrets, tail, rollback).
This project has no staging environment configured — deploys go straight to production. If that
changes, document the environment split here.
