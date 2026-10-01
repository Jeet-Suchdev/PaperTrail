# AGENTS.md — PaperTrail

Instructions for AI coding agents working in this repository. Read this file and `SPEC.md` before making changes. `SPEC.md` is the source of truth for features, data model, and API. This file defines *how* to work.

## Project summary

PaperTrail is a paper-trading web app for Indian markets (NSE/BSE): virtual cash, real (delayed) prices, no real orders. Stack: React + Vite + TypeScript (client), Node + Express + TypeScript (server), PostgreSQL + Prisma, Socket.IO, Zod, Vitest. AI features analyze the user's virtual portfolio.

The human owner is learning as they go. **Optimize for code that is readable and explainable, not clever.**

## How to work

1. **One slice at a time.** Work only on the slice the user names (see `SPEC.md` section 11). Do not build ahead.
2. **Plan first.** For anything non-trivial, briefly state your plan (files to create/change, approach) and wait for confirmation before writing lots of code.
3. **Small, focused changes.** Prefer several small steps over one giant change. Don't refactor unrelated code.
4. **Ask when unsure.** If the spec is ambiguous or conflicts with the request, ask. Do not silently invent behaviour.
5. **Run the checks.** Before saying a task is done, run typecheck, lint, and tests, and report the results honestly. If something fails or you couldn't run it, say so.
6. **Explain what you built.** After each task, give a short plain-language explanation of what changed and how a request flows through the code (e.g. button click → API route → service → DB). Assume the reader is a learner.
7. **Never claim something works without verifying it.** If you didn't run it, say "not run".

## Dependencies

- **Do not add a new dependency without asking.** Explain what it is for and why existing tools aren't enough.
- Use the stack in `SPEC.md`. Don't swap libraries (e.g. Prisma → another ORM, Socket.IO → raw ws) without approval.
- Pin to maintained, widely used packages. Avoid anything unmaintained.

## Commands

(Updated for Slice 0. `prisma migrate` / `prisma db seed` do not exist yet —
they are added in later slices.)

```
pnpm install
docker compose up -d     # start Postgres (creates papertrail + papertrail_test on first run)
cp server/.env.example server/.env
pnpm dev                 # run client and server (server runs prisma generate first)
pnpm --filter server dev
pnpm --filter client dev
pnpm test                # run all tests (server tests use the papertrail_test database)
pnpm typecheck
pnpm lint
pnpm format:check
```

## Code conventions

- TypeScript strict mode. No `any` without a comment explaining why. Prefer `unknown` and narrowing.
- Backend structure: `routes.ts` (thin HTTP layer) → `service.ts` (business logic) → Prisma. **No business logic in route handlers. No Prisma calls in route handlers.**
- Validate all external input (request body, params, query, env vars, third-party API responses, LLM output) with Zod.
- Use a consistent error shape: `{ error: { code, message, details? } }`. Use custom error classes and one central error-handling middleware.
- Use `async/await`. Always handle promise rejections. Never leave floating promises.
- Naming: `camelCase` variables/functions, `PascalCase` types/components, `kebab-case` file names for non-components, `PascalCase.tsx` for React components.
- Keep functions short and single-purpose. Add comments for *why*, not *what*.
- Frontend: function components and hooks, TanStack Query for server state, no data fetching inside random components (put it in `features/*/api.ts` hooks). Handle loading, error, and empty states for every data view.
- Import order: external, internal absolute, relative.

## Money rules (strict — see SPEC.md section 4)

- **Money is always integer paise. Never use floating point for money.** No `parseFloat`, no `toFixed` for calculations. Formatting for display happens only in the UI formatter.
- DB money columns are `BigInt`. Convert at the API boundary with the helper in `server/src/lib/money.ts`. Don't scatter `Number()` / `BigInt()` conversions around the codebase.
- Any operation that changes balances, holdings, or orders (buy, sell, cancel, fill, reserve, release) **must run inside a single Prisma transaction** and lock the wallet row to avoid double-spend.
- The ledger is append-only. Never update or delete ledger rows.
- Invariant: wallet cash always equals the sum of ledger entries. Don't write code that can break it.
- If you touch money logic, you must add or update tests in the same change.

## Market data rules (see SPEC.md section 6)

- The frontend **never** calls Yahoo or any market API. Only the backend does.
- All market access goes through the `MarketDataProvider` interface. Don't import `yahoo-finance2` outside the provider file.
- Orders execute against the **cached** price. Don't fetch a fresh price inside an order transaction.
- Provider failures must never crash the server: timeouts, retries with backoff, fallback to the simulated provider.
- Respect market hours and stale-price rules from the spec.
- Don't scrape NSE/BSE websites directly.

## AI feature rules (see SPEC.md section 9)

- Use the `LlmClient` interface. Don't call an LLM SDK directly from routes or services outside `modules/ai`.
- **The LLM does not do arithmetic.** The backend computes all numbers; the model narrates them. For chat, use tool calls to existing services, never raw SQL generated by the model.
- Validate LLM output (especially JSON/tool arguments) with Zod. Treat model output as untrusted.
- Prompts live in `modules/ai/prompts/`. Include the educational disclaimer in every user-facing AI response.
- Never produce price predictions or "buy/sell X" recommendations.
- Don't put emails, IDs, tokens, or secrets in prompts. Rate limit and cache AI endpoints.

## Security

- **Never commit secrets.** `.env` must be in `.gitignore` before the first commit. Only `.env.example` (no real values) is committed.
- Hash passwords with argon2 or bcrypt. Never log passwords, tokens, cookies, or API keys.
- Every data query must be scoped to the authenticated user. Check ownership on every `:id` route.
- Use `helmet`, restricted CORS, and rate limiting on auth and AI routes.
- Treat all user input as hostile. Parameterized queries only (Prisma handles this; don't use raw SQL with string interpolation).

## Database and migrations

- Schema changes go through Prisma migrations only. Never edit the database by hand or edit an already-applied migration.
- Name migrations descriptively. Keep the seed script (`prisma/seed.ts`) up to date; it should create a demo user with some holdings and trades.
- Use indexes for foreign keys and common lookups (e.g. orders by user and status).

## Testing

- Use Vitest. Integration tests run against a separate test database, not the dev database.
- Required coverage is listed in `SPEC.md` section 12. Money logic must have tests before the slice is considered done.
- Test behaviour, not implementation details. No tests that just assert mocks were called.
- Don't skip, delete, or weaken a failing test to make it pass. Fix the code or ask.

## Git

- Small, logical commits with clear messages (`feat: ...`, `fix: ...`, `test: ...`, `chore: ...`).
- Do not commit generated files, `node_modules`, `.env`, or build output.
- Never rewrite history or force push unless explicitly asked.
- Don't commit or push on your own unless asked. Tell the user when a slice is ready to commit.

## Things you must not do

- Don't build features outside the current slice or outside `SPEC.md` scope.
- Don't introduce real-money, broker, or payment functionality.
- Don't hardcode API keys, secrets, or URLs. Use validated env vars.
- Don't disable TypeScript checks, lint rules, or tests to get past an error.
- Don't leave `TODO`/placeholder implementations unflagged. If something is stubbed, say so clearly in your summary.
- Don't delete or overwrite user files without asking.

## When finished with a task

Reply with:
1. **What changed** (files and a short description)
2. **How it works** (the request flow in plain language)
3. **Checks run** (typecheck, lint, tests: results, or "not run")
4. **Known gaps or follow-ups**
5. **How to try it** (exact steps to see it working)
