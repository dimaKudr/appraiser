# Appraiser

A Cloudflare Worker that computes stock valuation signals (DCF fair value, Wall Street price
target/rating, Risk, Confidence) for a list of tickers, using Financial Modeling Prep (FMP) as
its data source. It is a pure calculator: tickers in, computed values out — it does not touch
Google Drive, IBKR, or any CSV directly. It's called by the `get-fair-values` Claude skill,
which handles ticker sourcing (IBKR watchlists) and CSV merge/upload (Google Drive).

## Architecture
Claude (`get-fair-values` skill)
→ resolves tickers via **IBKR** connector
→ `POST /calculate {"tickers": [...]}` → Appraiser Worker
→ **FMP API** (DCF, price target, rating, beta, net debt/EBITDA, revisions, price history)
→ deterministic bucket math (Risk/Confidence)
→ deterministic technical signal (SMA/RSI rules)
← {"results": [{ ticker, fairValue, wsTarget, wsRating, risk, confidence, warnings }]}
→ Claude merges into `fair-values.csv` and uploads to Drive

## Prerequisites

- Node.js 18+
- A Cloudflare account (free tier is fine)
- An FMP API key — https://financialmodelingprep.com (confirm which DCF endpoint tier your key
  has access to; see `src/fmp.ts` for notes)

## Setup
Generate WORKER_SHARED_SECRET= with:

```bash
openssl rand -hex 32
```

Install Wrangler and dependencies:

```bash
npm install
```

Log in to your Cloudflare account (opens a browser window):

```bash
npx wrangler login
```

Confirm you're authenticated as the right account:

```bash
npx wrangler whoami
```

## Local development

Run the Worker locally with hot reload:

```bash
npx wrangler dev
```

By default this serves on `http://localhost:8787`. For local dev, put your secrets in a
`.dev.vars` file (gitignored — never commit this):

```
FMP_API_KEY=your-fmp-key-here
WORKER_SHARED_SECRET=choose-a-long-random-string
```

Test it locally:

```bash
curl -X POST http://localhost:8787/calculate \
  -H "Authorization: Bearer choose-a-long-random-string" \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["NVDA", "AAPL"]}'
```

## Deploying

First deploy (creates the Worker on your account):

```bash
npx wrangler deploy
```

This prints the live URL, typically `https://appraiser.<your-subdomain>.workers.dev`.

Set production secrets (you'll be prompted to paste each value — these are encrypted and never
appear in `wrangler.toml` or git history):

```bash
npx wrangler secret put FMP_API_KEY
npx wrangler secret put WORKER_SHARED_SECRET
```

Re-deploy any time you change code:

```bash
npx wrangler deploy
```

## Verifying the live deployment

```bash
curl -X POST https://appraiser.<your-subdomain>.workers.dev/calculate \
  -H "Authorization: Bearer <your-shared-secret>" \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["NVDA"]}'
```

## Operating

Tail live logs while the skill runs against production:

```bash
npx wrangler tail
```

List your deployed Workers (to confirm this one is live and check its name):

```bash
npx wrangler deployments list
```

Roll back to a previous deployment if a bad version goes out:

```bash
npx wrangler rollback
```

View or rotate a secret (there's no "get" for secret values — only overwrite):

```bash
npx wrangler secret put FMP_API_KEY   # re-enter to rotate
npx wrangler secret list              # lists secret NAMES only, never values
```

Delete the Worker entirely (destructive — only if decommissioning):

```bash
npx wrangler delete
```

## API contract

```
POST /calculate
Authorization: Bearer <WORKER_SHARED_SECRET>
Content-Type: application/json

{ "tickers": ["NVDA", "AAPL"] }
```

Response:

```json
{
  "results": [
    {
      "ticker": "NVDA",
      "fairValue": 187.32,
      "wsTarget": 210.5,
      "wsRating": "Buy",
      "risk": "Medium",
      "confidence": "High",
      "warnings": []
    }
  ]
}
```

A ticker FMP can't resolve, or with partial data, always returns `200` with nulls and a
`warnings` array — never a 4xx for a single bad ticker in a batch.

## Known things to verify against a live FMP key

`src/fmp.ts` is isolated specifically so schema drift only touches one file. Two things are
marked `// VERIFY` in that file and should be checked against a real response before trusting
this in production:
- Exact field names on `ratings-snapshot` and `key-metrics-ttm`
- Whether your FMP plan's `discounted-cash-flow` endpoint is the free/legacy one or requires a
  paid tier

## Project structure

- src/index.ts — HTTP handler, auth, orchestration, Risk/Confidence bucket math
- src/fmp.ts — all FMP API calls, isolated for easy patching if their schema changes
- src/technical.ts — deterministic SMA/RSI-based technical entry signal
- wrangler.toml — Worker config (no secrets — see Setup)
