# PaperTrail — Product & Technical Spec

> A paper-trading (virtual stock trading) web app for Indian markets (NSE/BSE) with an AI layer that explains your portfolio and reviews your trades. No real money, no real orders, no broker integration. Built as a full-stack portfolio/learning project.

**Status:** v1 spec. Treat this file as the source of truth. If code and spec disagree, ask before changing either.

---

## 1. Goals and non-goals

### Goals
- Let a user sign up, receive virtual cash, and buy/sell real NSE/BSE stocks at (delayed) real market prices.
- Show holdings, live-ish prices, P&L, and portfolio history in a clean dashboard.
- Use WebSockets for live price and portfolio updates.
- Provide AI features that analyze the user's own portfolio and trades (explanation and education, **not** predictions or advice).
- Be a codebase that is correct around money, easy to explain in an interview, and easy to run locally.

### Non-goals (explicitly out of scope for v1)
- Real money, real brokers, importing portfolios from Zerodha/Groww/etc.
- Derivatives (F&O), margin/leverage, short selling, intraday square-off rules.
- Brokerage fees, STT, GST, and other charges (maybe a flat optional fee in v2).
- Mobile app, social features, leaderboards.
- AI price prediction or "buy/sell this" recommendations.
- Payments of any kind.

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + Vite + TypeScript | React Router, TanStack Query for server state, Tailwind for styling |
| Charts | Recharts (portfolio) or TradingView `lightweight-charts` (price charts) | Decide at the charts slice |
| Backend | Node.js + Express + TypeScript | Zod for validation |
| Realtime | Socket.IO | Rooms per user; server pushes price and portfolio updates |
| Database | PostgreSQL | Required for transactions |
| ORM / migrations | Prisma | Migrations from day one |
| Auth | Email + password, JWT in httpOnly cookie | Hash with argon2 or bcrypt |
| Market data | `yahoo-finance2` (unofficial, free) behind an interface | Plus a simulated provider as fallback |
| AI | LLM provider behind a service interface | Provider/model configurable via env |
| Testing | Vitest (unit + integration), Supertest for API | |
| Package manager | pnpm | |

TypeScript everywhere. No `any` unless commented with a reason.

---

## 3. Repository structure

```
papertrail/
├── AGENTS.md
├── SPEC.md
├── README.md
├── docker-compose.yml        # Postgres (and Redis later if needed)
├── server/
│   ├── prisma/               # schema.prisma, migrations, seed.ts
│   └── src/
│       ├── config/           # env parsing (Zod)
│       ├── modules/
│       │   ├── auth/
│       │   ├── wallet/
│       │   ├── orders/
│       │   ├── portfolio/
│       │   ├── watchlist/
│       │   ├── market/       # price service, providers, cache, poller
│       │   └── ai/
│       ├── realtime/         # Socket.IO setup and event emitters
│       ├── lib/              # money helpers, errors, logger
│       └── index.ts
└── client/
    └── src/
        ├── pages/
        ├── components/
        ├── features/         # feature-scoped hooks and components
        ├── lib/              # api client, socket client, formatters
        └── main.tsx
```

Each backend module has: `routes.ts` (HTTP), `service.ts` (business logic), `schemas.ts` (Zod), and tests. **Routes stay thin; business logic lives in services.**

---

## 4. Money rules (critical)

- All money is stored and computed as **integer paise** (₹1 = 100 paise). Never floats.
- DB money columns use `BigInt`. One helper in `server/src/lib/money.ts` converts to/from `number` at the API boundary (safe range is far above any realistic balance). The frontend receives paise as numbers and formats to ₹ with `Intl.NumberFormat('en-IN')`.
- Quantity is an integer (whole shares only in v1).
- Average buy price is stored in paise, rounded half-up, and recomputed on each buy.
- Every buy/sell/cancel/fill runs inside a **single database transaction** that updates the order, holdings, wallet, and ledger together. Use row-level locking (`SELECT ... FOR UPDATE`) or serializable isolation on the wallet row to prevent double-spend under concurrent requests.
- The ledger is append-only. Wallet balance must always equal the sum of ledger entries (add a test for this invariant).

Starting balance for new users: **₹10,00,000 (100,000,000 paise)**, configurable via env.

---

## 5. Data model

All tables have `id` (UUID or cuid), `createdAt`, `updatedAt` unless noted.

**User**
- `email` (unique), `passwordHash`, `name`

**Wallet** (one per user)
- `userId` (unique FK), `cashPaise` (BigInt, available), `reservedPaise` (BigInt, held for pending limit buys)

**Instrument**
- `symbol` (e.g. `RELIANCE`), `exchange` (`NSE` | `BSE`), `yahooSymbol` (e.g. `RELIANCE.NS`), `name`
- Unique on (`symbol`, `exchange`)

**Order**
- `userId`, `instrumentId`
- `side`: `BUY` | `SELL`
- `type`: `MARKET` | `LIMIT`
- `quantity` (int), `limitPricePaise` (nullable)
- `status`: `PENDING` | `FILLED` | `CANCELLED` | `REJECTED`
- `rejectReason` (nullable), `filledAt` (nullable)

**Trade** (a fill; one per filled order in v1)
- `orderId`, `userId`, `instrumentId`, `side`, `quantity`, `pricePaise`
- `realizedPnlPaise` (nullable, set on SELL: `(sellPrice - avgBuyPrice) * qty`)

**Holding**
- `userId`, `instrumentId`, `quantity`, `avgPricePaise`
- Unique on (`userId`, `instrumentId`). Row is deleted (or quantity 0) when fully sold.

**LedgerEntry** (append-only)
- `userId`, `type`: `INITIAL_CREDIT` | `BUY` | `SELL` | `RESERVE` | `RELEASE`
- `amountPaise` (signed), `balanceAfterPaise`, `orderId` (nullable)

**WatchlistItem**
- `userId`, `instrumentId`. Unique on the pair.

**DailyClose**
- `instrumentId`, `date`, `closePaise`. Unique on (`instrumentId`, `date`).

**PortfolioSnapshot** (one per user per day, for the history chart)
- `userId`, `date`, `totalValuePaise`, `cashPaise`, `investedPaise`

**AiInsight** (cache of generated AI output)
- `userId`, `kind` (`DAILY_SUMMARY` | `TRADE_REVIEW`), `inputHash`, `content`, `model`

Derived (not stored): current value, unrealized P&L, day change, sector allocation.

---

## 6. Market data service

Lives in `server/src/modules/market/`.

### Provider interface
```ts
interface MarketDataProvider {
  getQuotes(yahooSymbols: string[]): Promise<Quote[]>;
  searchInstruments(query: string): Promise<InstrumentSearchResult[]>;
  getHistory(yahooSymbol: string, range: HistoryRange): Promise<Candle[]>;
}
```
Implementations:
1. `YahooProvider` — uses `yahoo-finance2`.
2. `SimulatedProvider` — random-walk prices around a last known price. Used for tests, dev without internet, and as a fallback.

A `MARKET_PROVIDER` env var picks the default. On repeated failures from Yahoo, the service falls back to the simulated provider and flags prices as `isSimulated: true` so the UI can show a badge.

### Rules
- **The frontend never calls the market API.** Only the backend does.
- A poller collects the deduplicated set of symbols from all holdings, watchlists, and pending limit orders, fetches them in **batches**, and updates an in-memory cache every `PRICE_POLL_INTERVAL_SECONDS` (default 10).
- Cache stores `{ pricePaise, prevClosePaise, changePaise, changePercent, asOf, isSimulated }` per symbol.
- All order execution uses the **cached** price, never a fresh API call. Reject orders if the cached price is older than `MAX_PRICE_AGE_SECONDS` (default 120) during market hours.
- Respect market hours: NSE/BSE regular session is roughly 09:15–15:30 IST, Mon–Fri. Outside hours (and on holidays), stop polling and serve the last close. Orders placed outside market hours: **MARKET orders are rejected with a clear message in v1** (or an env flag `ALLOW_AFTER_HOURS_TRADING=true` fills them at last close for demo purposes).
- Add retry with backoff, request timeouts, and logging of failures. Never crash the server on a provider error.
- At market close, store a `DailyClose` row per tracked symbol and a `PortfolioSnapshot` per user.

---

## 7. API (REST)

Base path `/api`. JSON. All routes except auth require a valid session cookie. All inputs validated with Zod. Errors use a consistent shape: `{ error: { code, message, details? } }`.

**Auth**
- `POST /auth/register` — creates user + wallet with starting balance + `INITIAL_CREDIT` ledger entry (one transaction)
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

**Market**
- `GET /market/search?q=` — search instruments
- `GET /market/quote/:symbol` — cached quote
- `GET /market/history/:symbol?range=1D|1W|1M|1Y` — candles for charts

**Orders**
- `POST /orders` — body: `{ symbol, exchange, side, type, quantity, limitPricePaise? }`
- `GET /orders?status=&page=` — order history
- `DELETE /orders/:id` — cancel a pending limit order (releases reserved funds)

**Portfolio**
- `GET /portfolio` — wallet, holdings with current value, unrealized P&L, day change, totals
- `GET /portfolio/history?range=` — from `PortfolioSnapshot`
- `GET /portfolio/trades` — trade history with realized P&L

**Watchlist**
- `GET /watchlist`, `POST /watchlist`, `DELETE /watchlist/:symbol`

**AI** (rate limited)
- `POST /ai/summary` — daily/on-demand portfolio summary
- `POST /ai/trade-review` — analysis of recent trades
- `POST /ai/chat` — natural-language questions about the user's portfolio (tool-calling, see section 9)

**Dev only** (disabled in production)
- `POST /dev/reset` — reset current user's data to the initial state

---

## 8. Realtime (Socket.IO)

- Client connects after login; the server authenticates the socket using the same session cookie/JWT.
- Each socket joins a room `user:{userId}`.
- A client subscribes to symbols it is currently viewing: `subscribe` / `unsubscribe` with `{ symbols: string[] }`. The server maintains per-symbol rooms.

**Server → client events**
- `price:update` — `{ symbol, pricePaise, changePercent, asOf, isSimulated }`
- `portfolio:update` — recomputed totals for the user after price ticks (throttled, max once per few seconds)
- `order:update` — order status change (e.g. limit order filled)
- `market:status` — open/closed

Reconnection must work: on reconnect the client re-subscribes and refetches the portfolio.

---

## 9. AI features

AI is an **analysis and education layer**. It must never present itself as a financial advisor, and every AI response ends with a short disclaimer: *"Educational only, based on virtual trades. Not investment advice."*

### Architecture rules
- All AI code lives in `server/src/modules/ai/` behind an `LlmClient` interface so the provider/model can be swapped via env.
- **Numbers are computed by the backend, not the LLM.** The LLM receives pre-computed facts (allocation percentages, P&L, top movers) and writes the narrative. For chat, it uses tool calls that hit existing services (`get_portfolio`, `get_holdings`, `get_trades`, `get_quote`) and never raw SQL.
- Only send the data needed for the request. No emails, passwords, or IDs in prompts.
- Cache results in `AiInsight` keyed by an input hash so repeated requests don't re-bill.
- Rate limit per user. Set `max_tokens` and request timeouts. Handle provider failures gracefully (show a friendly error, never crash).
- Prompts live in dedicated files (`prompts/*.ts`), not inline in route handlers.

### Features (in priority order)
1. **Portfolio summary** — "You're up 1.8% today, driven mainly by X. 58% of your portfolio is in one sector."
2. **Trade review** — patterns in the user's closed trades: holding time, win rate, selling winners early, overtrading, concentration.
3. **Natural-language Q&A** — "Which of my holdings is down the most this week?" via tool calls.
4. **Learning coach** — explains terms (P/E, diversification, limit vs market) in the context of the user's own holdings.

**Not allowed:** price predictions, "you should buy/sell X", guaranteed-return language.

---

## 10. Frontend pages

- **Login / Register**
- **Dashboard** — portfolio value, day change, cash, allocation chart, history chart, top holdings, AI summary card
- **Stock page** — price chart, live price, buy/sell panel, add to watchlist
- **Holdings** — table with qty, avg price, LTP, current value, P&L, day change (live-updating)
- **Orders** — history and pending orders with cancel
- **Watchlist**
- **AI Assistant** — chat panel and trade review
- Shared: top bar with market status and cash balance, loading skeletons, error toasts, an "isSimulated" badge when applicable

Design: clean, responsive, light/dark mode. Gains green, losses red, but never rely on colour alone (use +/− signs and arrows). Indian number formatting (₹1,23,456.78).

---

## 11. Build plan (vertical slices)

Each slice must work end to end (DB → API → UI) with tests passing and be committed before starting the next.

**Slice 0 — Foundation**
- Repo, pnpm workspaces or two packages, docker-compose Postgres, Prisma setup, env validation, lint/format, Vitest, health endpoint, basic React shell.
- *Done when:* `pnpm dev` runs both apps and a health check renders in the UI.

**Slice 1 — Auth + wallet**
- Register/login/logout/me, wallet creation with starting balance and ledger entry.
- *Done when:* a user can register, log in, see their ₹10,00,000 balance; passwords are hashed; protected routes reject anonymous requests.

**Slice 2 — Market data service (backend only first)**
- Provider interface, Yahoo + simulated providers, cache, poller, search and quote endpoints, market hours logic.
- *Done when:* `GET /market/quote/RELIANCE` returns a cached price; killing the network falls back to simulated data without crashing.

**Slice 3 — Trading core**
- Market orders (buy/sell), holdings, average price, ledger, realized P&L, order history. All in transactions.
- *Done when:* unit and integration tests cover: insufficient funds, selling more than held, average price recalculation, concurrent buys, and the wallet-equals-ledger invariant.

**Slice 4 — Realtime + dashboard**
- Socket.IO, live prices, portfolio updates, holdings table, dashboard.
- *Done when:* prices tick in the UI without refresh and survive a reconnect.

**Slice 5 — Charts, history, watchlist**
- Price charts, daily closes, portfolio snapshots, history chart, watchlist.

**Slice 6 — Limit orders**
- Pending orders, fund reservation, matching check on every price tick, cancel, `order:update` events.
- *Done when:* a limit buy fills automatically when price crosses the limit, and cancelling releases reserved funds.

**Slice 7 — AI features**
- LLM client, summary, trade review, chat with tools, caching, rate limits, disclaimer.

**Slice 8 — Polish**
- Error and empty states, responsive layout, dark mode, seed script with a demo account, README with screenshots, deployment notes.

---

## 12. Testing requirements

Minimum, non-negotiable (money logic):
- Buy: success, insufficient funds, qty ≤ 0, unknown symbol, stale price.
- Sell: success, selling more than held, selling an unowned stock, realized P&L correctness.
- Average price recalculation after multiple buys and partial sells.
- Concurrency: two simultaneous buys cannot overspend.
- Invariant: wallet cash equals the sum of ledger entries.
- Limit order: reserve, fill, cancel, release.

Also: auth route protection, Zod validation on every route, price service fallback behaviour.

---

## 13. Environment variables

```
DATABASE_URL=
JWT_SECRET=
COOKIE_SECURE=false
CLIENT_ORIGIN=http://localhost:5173
STARTING_BALANCE_PAISE=100000000
MARKET_PROVIDER=yahoo            # yahoo | simulated
PRICE_POLL_INTERVAL_SECONDS=10
MAX_PRICE_AGE_SECONDS=120
ALLOW_AFTER_HOURS_TRADING=false
LLM_PROVIDER=
LLM_MODEL=
LLM_API_KEY=
AI_RATE_LIMIT_PER_HOUR=20
```
Provide `.env.example` with all keys and no secrets. Validate all env vars with Zod at startup and fail fast.

---

## 14. Security basics

- httpOnly, sameSite cookies; CORS restricted to `CLIENT_ORIGIN`.
- Rate limit auth and AI endpoints (`express-rate-limit`).
- `helmet` for headers.
- Never log passwords, tokens, or API keys.
- Authorization on every query: users can only see and modify their own data.

---

## 15. Definition of done (per slice)

- Feature works end to end in the browser.
- Tests for the slice pass (`pnpm test`), plus lint and typecheck.
- No secrets committed; `.env.example` updated.
- README/SPEC updated if behaviour changed.
- Committed with a clear message.
- You (the human) can explain how the main request flows through the code.

---

## 16. Open questions / future ideas

- Fractional shares? Brokerage and tax simulation? Leaderboards? Price alerts? Portfolio benchmark vs Nifty 50? Export to CSV?
- Redis for the price cache if running multiple server instances.
