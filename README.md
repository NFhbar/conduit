# Conduit Ledger

A double-entry accounting ledger built with NestJS + TypeScript. 

## Stack

- Node.js (LTS) + TypeScript (`strict: true`)
- NestJS 10 - Why NestJS? NestJS provides a robust framework with little initial "investement" which allows for a solid platform to build on.

## TLDR

```bash
nvm use                    
npm install
cp .env.example .env
npm run start:dev
```

## Scripts

| Command            | What it does                                            |
| ------------------ | ------------------------------------------------------- |
| `npm run build`    | Compile to `dist/`                                      |
| `npm run start`    | Start the server                                        |
| `npm run start:dev`| Start with watch reload                                 |
| `npm test`         | Unit tests (domain + service layers)                    |
| `npm run test:e2e` | End-to-end HTTP tests against the full Nest application |
| `npm run lint`     | ESLint (auto-fix)                                       |
| `npm run format`   | Prettier                                                |

## API

Postman collection: [conduit.postman_collection.json](conduit.postman_collection.json)

| Method | Path                       | Purpose                                                            |
| ------ | -------------------------- | ------------------------------------------------------------------ |
| `POST` | `/accounts`                | Create an account.                                                 |
| `GET`  | `/accounts`                | List accounts (paginated, newest-first).                           |
| `GET`  | `/accounts/:id`            | Fetch a single account.                                            |
| `GET`  | `/accounts/:id/entries`    | List entries that have touched the account (paginated, history).   |
| `POST` | `/transactions`            | Apply a balanced double-entry transaction.                         |
| `GET`  | `/transactions`            | List transactions (paginated, newest-first).                       |
| `GET`  | `/reconciliation`          | Replay the ledger and report drift (read-only).                    |

Every state changing (`POST`/`PUT`/`PATCH`/`DELETE`) endpoint accepts an optional `Idempotency-Key` header — see [Idempotency](#idempotency). Pagination on every list endpoint uses the same `{ items, total, offset, limit }` envelope; defaults `offset=0`, `limit=20`, max `limit=100`. Status-code conventions are documented at the bottom of this section.

### Idempotency

Every state-changing endpoint (`POST`/`PUT`/`PATCH`/`DELETE`) accepts an optional `Idempotency-Key` request header. Roughly based on Stripe's idempotency.

- A first request with a given key is processed normally and its outcome (status + body) is cached.
- A subsequent request with the **same key and same body** replays the original outcome verbatim — same status, same body, no side effects.
- A subsequent request with the **same key and a different body** is rejected with `409`.
- Cached error responses (any `4xx`) are replayed too, so a retry of a known-bad request returns the same error rather than re-running validation.

Keys are non-empty strings up to 255 characters. Without the header, endpoints behave as documented.

```bash
curl -X POST http://localhost:5000/transactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01J9X3K2VQE7G4Z9TC4VB2A1MN' \
  -d '{ "entries": [...] }'
```

### `POST /accounts`

Creates an account.

| Field       | Required | Description                                                              |
| ----------- | -------- | ------------------------------------------------------------------------ |
| `id`        | no       | Any non-empty string. Generated as UUID v4 when omitted.                 |
| `name`      | no       | Optional label.                                                          |
| `direction` | yes      | `"debit"` or `"credit"`.                                                 |
| `balance`   | no       | Opening balance in USD (default `0`, ≥ 0, max two decimal places).       |

```bash
curl -X POST http://localhost:5000/accounts \
  -H 'Content-Type: application/json' \
  -d '{"name":"test3","direction":"debit","id":"71cde2aa-b9bc-496a-a6f1-34964d05e6fd"}'
```

```json
{
  "balance": 0,
  "direction": "debit",
  "id": "71cde2aa-b9bc-496a-a6f1-34964d05e6fd",
  "name": "test3",
  "created_at": "2026-05-05T10:00:00.000Z",
  "updated_at": "2026-05-05T10:00:00.000Z"
}
```

`created_at` and `updated_at` are ISO 8601 UTC. `updated_at` equals `created_at` until the account participates in a transaction; thereafter it advances to the timestamp of the most recent commit.

Two internal fields are intentionally not surfaced on the wire:

- **`Account.openingBalanceCents`** — drives reconciliation's replay; not part of the public contract.
- **`Account.version`** — optimistic-concurrency token. Internal-only today because no endpoint accepts a version constraint on input. Exposing it later (so clients can do their own `If-Match`-style optimistic checks on their own actions) is a one-line mapper change.

### `GET /accounts/:id`

Returns the account, or `404` if it does not exist.

```bash
curl http://localhost:5000/accounts/71cde2aa-b9bc-496a-a6f1-34964d05e6fd
```

### `GET /accounts`

Lists accounts, newest-first. Paginated via query params; both default and bounded. Empty store returns `total: 0` with an empty `items` array.

| Query param | Required | Description                                |
| ----------- | -------- | ------------------------------------------ |
| `offset`    | no       | Default `0`. ≥ 0.                          |
| `limit`     | no       | Default `20`. 1–100.                       |

```bash
curl 'http://localhost:5000/accounts?offset=0&limit=20'
```

```json
{
  "items": [ /* AccountResponse[] */ ],
  "total": 42,
  "offset": 0,
  "limit": 20
}
```

### `GET /accounts/:id/entries`

Account history: every entry that has touched the account, newest-first. Same pagination shape as `GET /accounts`. Returns `404` when the account does not exist (rather than an empty page — distinguishes "no entries yet" from "no such account").

```bash
curl 'http://localhost:5000/accounts/71cde2aa-b9bc-496a-a6f1-34964d05e6fd/entries?offset=0&limit=20'
```

### `POST /transactions`

Applies a balanced double-entry transaction. The sum of debit-entry amounts must equal the sum of credit-entry amounts. The whole transaction is validated before any account balance is modified; if any check fails, no account is touched.

| Field     | Required | Description                                                                                          |
| --------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `id`      | no       | Any non-empty string. Generated as UUID v4 when omitted.                                             |
| `name`    | no       | Optional label.                                                                                      |
| `entries` | yes      | Array of entries (≥ 2). Each entry: `id?` (any non-empty string, generated when omitted), `account_id` (non-empty string referencing an existing account), `direction` (`"debit"` or `"credit"`), `amount` (USD, > 0, max two decimal places). |

```bash
curl -X POST http://localhost:5000/transactions \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "test",
    "id": "3256dc3c-7b18-4a21-95c6-146747cf2971",
    "entries": [
      {"direction":"debit","account_id":"fa967ec9-5be2-4c26-a874-7eeeabfc6da8","amount":100},
      {"direction":"credit","account_id":"dbf17d00-8701-4c4e-9fc5-6ae33c324309","amount":100}
    ]
  }'
```

The response carries `created_at` on both the transaction and every entry, plus `transaction_id` on every entry (back-reference to the parent). All timestamps within a single transaction are identical — the whole apply happens at one instant.

### `GET /transactions`

Lists transactions, newest-first, with the same pagination shape as `GET /accounts`.

```bash
curl 'http://localhost:5000/transactions?offset=0&limit=20'
```

### `GET /reconciliation`

Re-derives every account's expected balance by replaying the entry history on top of its opening balance, then compares to the stored balance. Read-only — drift is reported, never auto-corrected.

```bash
curl http://localhost:5000/reconciliation
```

```json
{
  "status": "ok",
  "accountsChecked": 2,
  "transactionsReplayed": 5,
  "globalSignedSum": 0,
  "globalOpeningSignedSum": 0,
  "globalInvariantHolds": true,
  "discrepancies": [],
  "orphanEntries": [],
  "checkedAt": "2026-05-05T10:00:00.000Z"
}
```

The report surfaces three independent signals; `status === "ok"` requires all three:

| Field | Meaning |
| --- | --- |
| `discrepancies[]` | Per-account: `actualBalance` doesn't match the replayed `expectedBalance`. `diff = actual - expected` (positive = stored balance higher than the entry history justifies; negative = lower). |
| `orphanEntries[]` | Entries whose `accountId` doesn't match any stored account. Reported rather than silently dropped — a reconciliation control surfaces inconsistency, it doesn't hide it. |
| `globalInvariantHolds` | `globalSignedSum` (`Σ balance × directionSign`, debit `+1` / credit `-1`) equals `globalOpeningSignedSum`. Mathematically implied by the per-account check, but cross-checks the replay algorithm itself. |

Per-account checks are strictly stronger than the global signed sum, but both are surfaced because the redundancy catches a transposition (drift in two accounts that cancels in the global sum) and a future bug in the replay algorithm itself.



## Design

A few decisions worth flagging:

- **Repository interfaces + DI tokens.** Services depend on `AccountsRepository` / `TransactionsRepository` interfaces, not concrete classes. Swapping in a real database later means writing one new implementation file and rebinding the token in the module.
- **Internal storage is integer cents.** `dollarsToCents` runs at the wire boundary; mappers convert back on the way out. This keeps arithmetic exact and makes the balance-equality check trustworthy.
- **Atomic application.** `LedgerService.applyTransaction` validates the whole transaction (existence, balance, positive amounts) *before* mutating any account. On any failure during validation, no balance is touched.
- **Single-process, single-threaded** Node's event loop serializes the in-memory mutations, so no locks are needed in v1. Optimistic concurrency (`Account.version`) is already in place for when multi-worker reads-and-writes start happening under a real database, `LedgerService.applyTransaction` is the one place that wraps in a SQL transaction or `dataSource.transaction(...)`. 
- **Module exports are minimal.** `AccountsModule` exports its service and the repository token (the latter so `LedgerService` can inject it). The concrete in-memory class is private to the module.

## Decisions

- **Negative balances are allowed.** The spec defines direction updates but doesn't forbid going below zero, and a credit-direction "balance" of $0 still has well-defined semantics under our rules. An overdraft guard would slot into `LedgerService.applyTransaction` between the balance computation and the commit.
- **Initial balance must be ≥ 0** (`@Min(0)` on `CreateAccountDto.balance`). Opening with debt requires a transaction to record why; the create-then-immediately-broken-invariant case felt worse than the rejection. Easy to relax.
- **Zero-amount entries are rejected** (`@IsPositive()` on `EntryDto.amount`). They'd pass `isBalanced` trivially but carry no economic meaning, rejected for cleanliness.
- **Empty and single-entry transactions are rejected** at the DTO layer (`@ArrayMinSize(2)`). With strictly-positive amounts a single entry can never balance, so we fail fast with a clear validation error rather than letting the balance check produce a less specific message.
- **Multiple entries on the same `account_id` are allowed.** Useful for fee splits and similar patterns; the per-account accumulator in `LedgerService.applyTransaction` applies them in order.
- **Duplicate entry ids within a single transaction are not rejected.** Currently harmless because entries are nested under transactions and never looked up independently. If we add a `GET /transactions/:id/entries/:entry_id` later, this would change.
- **`amount` must be a JSON number, not a numeric string.** `class-validator`'s `@IsNumber` enforces this, we set `transform: true` on the global `ValidationPipe` but deliberately did **not** enable `enableImplicitConversion`.
- **Caller-supplied ids are non-empty strings, not necessarily UUID v4.** The spec says ids are "generated on object creation" if absent but doesn't constrain the format when supplied. Forcing UUID v4 would block legitimate business-key patterns like `acc-customer-42`. All four id fields (`account.id`, `transaction.id`, `entry.id`, `entry.account_id`) use `@IsString() @IsNotEmpty()`. Generated ids are still UUID v4. Easy to tighten back to `@IsUUID(4)` if the team wants the stricter contract. I would personally prefer to use https://github.com/jetify-com/typeid-js.
- **No upper bound on `entries` array size or `amount` magnitude.** `Number.MAX_SAFE_INTEGER` ≈ 9 × 10¹⁵ cents (~$90T) so integer overflow is theoretical for USD. An `@ArrayMaxSize(N)` and an explicit body-size limit are cheap DoS defences worth adding before exposing this on the open internet, see `Production readiness` for the broader API hardening list. Skipped in v1 to avoid an arbitrary bound this small surface doesn't yet need.
- **Repository errors are translated at the service boundary.** Repos throw typed `DuplicateIdError` / `EntityNotFoundError` (Nest-agnostic, defined in `src/common/repository-errors.ts`); services catch and re-throw as `ConflictException` / `NotFoundException`. Keeps `domain/` and storage-layer code free of `@nestjs/common` while preserving correct HTTP status codes if a future async backend ever races a service-level pre-check.
- **`name` is omitted from responses when absent** rather than emitted as `null`. Mappers branch on `account.name !== undefined` explicitly so the wire contract is a deliberate "field present iff set", not an accident of `JSON.stringify` dropping `undefined` keys.
- **Idempotency cache is scoped by `(method, path, key)`, not the header alone.** Two clients reusing the same `Idempotency-Key` value across different endpoints get independent cache entries — same shape Stripe uses. The composition lives in the interceptor as `${method} ${path}\0${key}`.
- **Idempotency caches 2xx and 4xx `HttpException`s; everything else passes through.** Validation/business 4xxs are stable verdicts and replaying them is correct. 5xx `HttpException`s (`InternalServerErrorException`, `ServiceUnavailableException`, …) are *not* cached — those are usually transient, and pinning the failure for the lifetime of the key would defeat the very retry the caller wants. Raw `Error`s also bypass the cache for the same reason.
- **Idempotency repository is first-write-wins.** Once a key is saved, it's immutable for the lifetime of the entry. Aligns with the contract a Redis/Postgres backend would provide via `SETNX` / `INSERT … ON CONFLICT DO NOTHING`, so swapping stores doesn't change observable behavior.
- **Body fingerprint is order-sensitive (`sha256(JSON.stringify(body))`) and fingerprints the *raw* request body, before validation.** Two consequences: (a) a different field order in the JSON yields a different fingerprint, so machine clients with stable serialization match cleanly while hand-edited retries can trip a 409; (b) `whitelist: true` strips extraneous fields *after* the interceptor runs, so the cache contract is on the bytes the client sent, not the validated DTO. Both are deliberate; canonical-JSON fingerprinting is a future improvement.
- **No TTL on idempotency entries** (process lifetime). A real backing store would add one (Stripe uses 24 h).
- **Reconciliation is read-only and reports drift but never auto-corrects.** Silent rewrites in a financial system are how reconciliation tools become the bug rather than catching it; if drift is real, a human investigates. To make replay possible, `Account` carries an immutable `openingBalanceCents` separately from `balanceCents`; `withBalance` mutates only the latter.
- **Reconciliation surfaces three independent signals** (per-account discrepancies, orphan entries, the global signed-sum invariant) and `status === "ok"` requires all three. The per-account check is mathematically the strictly-stronger one, but the global cross-check guards against bugs in the replay algorithm itself, and the orphan-entry signal would otherwise be silently dropped — both worth surfacing rather than hiding behind the per-account result. The dual-invariant story is why a transposition (e.g. `+X` to a debit account and `+X` to a credit account, which cancels in the global sum) still fires as drift.
- **Optimistic concurrency on accounts.** `Account.version` is read alongside the rest of the entity; `AccountsRepository.update` only commits when the stored version matches what the caller observed, then bumps it. Throws `StaleVersionError` on mismatch; `LedgerService` translates that to `ConflictException` (409) at the HTTP boundary, same retry contract as the duplicate-id 409. In single-threaded Node + synchronous repos the race is unreachable today, but the check is the seam that keeps `LedgerService` correct under any future async backend or multi-worker deployment without rewriting it — the version field maps directly to a SQL `UPDATE … WHERE version = ?` when persistence lands. `version` is internal-only on the wire for now; exposing it later (so clients can do their own optimistic constraints) is a one-line mapper change.
- **Timestamps + entry back-reference for audit.** Every entity carries a `createdAt`; `Account` additionally carries `updatedAt` (advances on every successful balance commit, equal to `createdAt` until the first transaction); every `Entry` carries a `transactionId` back-reference so it names its parent without a join. The clock is **injectable** at the service boundary — `AccountsService.create(input, now?)` and `LedgerService.applyTransaction(input, now?)` — defaulting to `new Date()`. A single `now` flows through one `applyTransaction`: the same instant lands on the transaction, every entry, and every touched account's `updatedAt`. Wire fields are snake_case (`created_at`, `updated_at`, `transaction_id`) to match the spec's existing `account_id` convention; mixed conventions on the wire would be worse than either.
- **Pagination uses an offset/limit envelope (`{ items, total, offset, limit }`)** sorted by `createdAt` descending with `id` as tiebreaker. Defaults are `offset=0`/`limit=20`; `limit` is capped at `100`. Two repository methods, two contracts: `findAll()` is the unbounded sweep used by reconciliation (where the full set is genuinely needed in memory), and `findPage(query)` is the bounded API for HTTP listings — committed to in the interface comments so a future paginated endpoint contributor doesn't accidentally inherit the sweep semantics. Cursor-based pagination would be sturdier under high write rates (offsets shift when rows are inserted near the top) — flagged as a future improvement, not a v1 hazard.

## Extending this code

The state of the code is a balance between the required features from the spec and possible future improvements while making sure there is no over-engineering as much as possible. 

| Likely ask                                     | Where it plugs in                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Swap in a real database                        | New `Postgres*Repository` implementing the interface; rebind the DI token in the module's providers. |
| `GET /transactions/:id`                        | Repository already has `findById`; expose a controller route through `LedgerService`.                |
| Cursor-based pagination                        | Replace `findPage({ offset, limit })` with a cursor-keyed signature; `LedgerService` is unaffected     |
| Reverse / void a transaction                   | New `LedgerService.reverseTransaction(id)` — build the inverse entries, reuse the apply path.        |
| Pending vs. posted states                      | Add `status` to `Transaction`; existing `applyTransaction` becomes the "post" path.                  |
| Multi-currency                                 | `amount` becomes `{ amount, currency }`; `isBalanced` enforces per-currency balance.                 |
| Concurrency under a real DB                    | Optimistic-concurrency scaffolding (`Account.version` + version-checked `update`) is in place; the SQL form is `UPDATE … WHERE version = ?`. The single SQL-transaction-or-row-lock seam is still `LedgerService.applyTransaction`. |
| Audit log / event stream                       | Emit from `LedgerService.applyTransaction` after a successful apply.                                  |


## Production readiness

These are the areas I would tackle first to harden the service.

**1. Persistence and consistency** ([details](#persistence-via-typeorm))
Real database, schema migrations, indexes (especially on `Entry.accountId` for account history). Atomicity moves from "Node serializes us" down to a SQL transaction wrapping `LedgerService.applyTransaction`. Concurrency safety is already in code via optimistic concurrency on accounts (`Account.version` + version-checked `update`); the SQL form is `UPDATE … WHERE version = ?`, which means the day persistence lands `LedgerService` doesn't change — the seam is correct, the SQL wrap removes the partial-commit window.

**2. Authentication and authorization**
None today. Production needs auth at the controller boundary (API keys for service-to-service, OAuth/JWT for human users) and a notion of *ownership*: callers should only act on their own accounts. Multi-tenancy implies a `tenantId` on the entities and an interceptor scoping every repository query.

**3. Idempotency for safe retries** ([implemented](#idempotency))
The `Idempotency-Key` header is wired and tested today. What's *missing* for production: a TTL on cached entries (Stripe uses 24 h), an atomic check-and-set so two concurrent requests with the same key can't both miss the cache, and a real backing store (Redis) — none of which the in-memory map gives us.

**4. Observability** ([logging details](#logging))

- **Metrics** — request rate, latency, error rate per endpoint, plus ledger-specific business metrics. Prometheus or StatsD.
- **Distributed tracing** — OpenTelemetry, especially once a real DB and any downstream services exist.
- **Health endpoints** — `/healthz` (liveness) and `/readyz` (readiness, checks DB connectivity). [`@nestjs/terminus`](https://docs.nestjs.com/recipes/terminus) has the building blocks.

**5. API hardening**

- **Rate limiting** per IP and per API key ([`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting)).
- **Body size limits**, **CORS allowlist**, **security headers** via `helmet`.
- **OpenAPI / Swagger** auto-generated from the existing DTO decorators ([`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction))
- **API versioning** (e.g. `/v1/…`) once the surface grows past three endpoints.

**6. Resilience and operations**

- **Graceful shutdown**: handle `SIGTERM`, drain in-flight requests, close DB connections.
- **Timeouts and circuit breakers** on any external call.
- **Containerized build** + a CI/CD pipeline running build + tests on every PR.
- **Secrets management** beyond `dotenvx` — Vault / AWS Secrets Manager / similar in prod.

**7. Compliance, audit, and integrity**

- **Immutable transactions and entries** enforced at the storage layer; reversals are new transactions, never edits.
- **Audit log** of every state-changing call (who, when, what).
- **Reconciliation as a scheduled job.** The endpoint ([details](#get-reconciliation)) ships today and exposes the same logic on demand; productionizing means a `@Cron`-driven job (`@nestjs/schedule`) that runs nightly, alerts on `status: drift_detected`, and snapshots the report for audit. The endpoint itself should also be auth-gated — it leaks the full account list, useful for an operator and not for the public.
- **Retention policy** (financial systems often require 7+ years) with a PII-deletion path that scrubs personal fields without breaking audit immutability.

**8. Money handling at scale**

- **Multi-currency** ([already noted](#extending-this-code)), `amount` becomes `{ amount, currency }`; `isBalanced` enforced per currency.
- **Higher precision** for currencies / contexts that need more than two decimal places. Either currency-specific scale factors over our cents helper, or move to `dinero.js` / `decimal.js` for arbitrary precision.

**9. Testing depth**

- **Property-based tests** ([`fast-check`](https://github.com/dubzzz/fast-check)) for ledger invariants — for any random sequence of valid transactions, the signed sum across all accounts stays constant.
- **Load tests** (k6, Artillery) once a real DB is in.
- **Contract tests** against the generated OpenAPI spec for any downstream consumers.

