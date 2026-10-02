# PaperTrail

**Practice investing in Indian markets without risking real money.**

PaperTrail is a full-stack paper-trading web app for NSE/BSE stocks. Start with virtual cash, trade at real (delayed) market prices, track your portfolio live, and get AI-powered explanations of how you're doing and why. No real orders, no brokers, no real money.

> **Status:** 🚧 In active development. See the [roadmap](#roadmap) for what's built so far.

<!-- Add a screenshot or short GIF of the dashboard here once Slice 4 is done -->

## Features

- **Virtual portfolio:** every account starts with ₹10,00,000 of virtual cash
- **Real market prices:** NSE/BSE quotes via a backend price service with caching and a simulated fallback
- **Live updates:** prices and portfolio value stream to the browser over WebSockets
- **Market and limit orders:** limit orders fill automatically when the price crosses your limit
- **Portfolio analytics:** holdings, unrealized and realized P&L, day change, allocation, history charts
- **Watchlist:** track stocks you haven't bought yet
- **AI insights:** plain-language portfolio summaries, trade reviews that spot patterns in your behaviour, and a chat assistant that answers questions about your own holdings

> PaperTrail is an educational tool. AI output is based on virtual trades and is **not investment advice**.

## Tech stack

| Area | Tools |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS, TanStack Query |
| Backend | Node.js, Express, TypeScript, Zod |
| Realtime | Socket.IO |
| Database | PostgreSQL, Prisma |
| Market data | `yahoo-finance2` behind a provider interface, plus a simulated provider |
| AI | LLM behind a swappable client interface |
| Testing | Vitest, Supertest |

## Engineering highlights

Implemented:

- **Money is handled as integer paise**, never floating point.
- **Registration is atomic:** user, wallet, and opening ledger entry are created in a single database transaction.
- **Append-only ledger design:** the wallet balance equals the sum of ledger entries, and a test checks it.
- **Auth done carefully:** argon2id password hashing, httpOnly cookie sessions (no tokens in browser storage), generic login errors, a timing-safe login path, and rate-limited auth routes.

Planned (see roadmap):

- Every trade in a single transaction with wallet row locking
- One price poller serving all users, with fan-out over WebSockets
- Automatic fallback to simulated prices when the market data provider fails
- AI features where the backend computes every number and the model only narrates

## Roadmap

- [x] Foundation (monorepo, Postgres, Prisma, tooling)
- [x] Auth and wallet
- [ ] Market data service
- [ ] Trading core (market orders, holdings, P&L)
- [ ] Realtime dashboard
- [ ] Charts, history, watchlist
- [ ] Limit orders
- [ ] AI features
- [ ] Polish, seed data, deployment

## Getting started

### Prerequisites

- Node.js 22.12+ (this project is developed on Node 25)
- [pnpm](https://pnpm.io) 12: `npm install -g pnpm`
- Docker Desktop (PostgreSQL runs in a container)

### Setup

```bash
pnpm install                                     # install workspace dependencies
docker compose up -d                             # start PostgreSQL (papertrail + papertrail_test)
cp server/.env.example server/.env               # create your local environment file
# edit server/.env and set JWT_SECRET to a random string of 32+ characters:
#   openssl rand -base64 48
pnpm --filter server prisma migrate dev          # create the database tables
pnpm dev                                         # run server (:3001) and client (:5173)
```

Open http://localhost:5173, register an account, and you'll land on a dashboard
showing your ₹10,00,000.00 virtual balance. The `/health` page runs `SELECT 1`
against PostgreSQL, so a green "OK" badge means client, server, and database
are all connected.

Notes:

- `pnpm dev` runs `prisma generate` for you.
- Integration tests run against the separate `papertrail_test` database
  (`DATABASE_URL_TEST`). The test run applies migrations to it automatically,
  and `pnpm test` never touches your dev data.

### Useful commands

```bash
pnpm test           # run all tests
pnpm typecheck      # TypeScript, both packages
pnpm lint           # ESLint
pnpm format:check   # Prettier
```

## Disclaimer

PaperTrail is a simulation for learning. It does not execute real trades, does not connect to any broker, and does not provide financial advice. Market data may be delayed or inaccurate.

## License

TBD (MIT is a common choice for portfolio projects)
