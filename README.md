# Conduit Ledger

A double-entry accounting ledger built with NestJS + TypeScript. Storage is in-memory.

## Stack

- Node.js (LTS) + TypeScript (`strict: true`)
- NestJS 10 - Why NestJS? NestJS provides a robust framework with little initial "investement" which allows for a solid platform to build on.
- `class-validator` + `class-transformer` for request validation
- `uuid` for generated identifiers
- Jest + supertest for tests

## TLDR

```bash
nvm use                    # optional — picks up the Node version from .nvmrc
npm install
cp .env.example .env
npm run start:dev
```

Node version is pinned in `.nvmrc` (24.12.0); CI reads the same file so local and CI run on the same runtime. `.env` is loaded automatically via `dotenv/config` at the top of `src/main.ts`. Currently the only variable is `PORT` (defaults to `5000` when unset).

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
  "name": "test3"
}
```

### `GET /accounts/:id`

Returns the account, or `404` if it does not exist.

```bash
curl http://localhost:5000/accounts/71cde2aa-b9bc-496a-a6f1-34964d05e6fd
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

### Status codes

| Code | When                                                                      |
| ---- | ------------------------------------------------------------------------- |
| 201  | `POST` succeeded                                                          |
| 200  | `GET` succeeded                                                           |
| 400  | Body failed validation, transaction not balanced, non-positive amount     |
| 404  | Account not found, or an entry references an unknown `account_id`         |
| 409  | `id` collision (duplicate account or transaction id)                      |

Error bodies use NestJS's default shape: `{ "statusCode": …, "message": …, "error": … }`.

## Design

A few decisions worth flagging:

- **Pure domain layer.** `src/domain/*` has no Nest imports. The balancing rules and money helpers are plain functions, easy to unit-test, and reusable from a CLI/worker without bootstrapping the framework.
- **Repository interfaces + DI tokens.** Services depend on `AccountsRepository` / `TransactionsRepository` interfaces, not concrete classes. Swapping in a real database later means writing one new implementation file and rebinding the token in the module.
- **Internal storage is integer cents.** `dollarsToCents` runs at the wire boundary; mappers convert back on the way out. This keeps arithmetic exact and makes the balance-equality check trustworthy.
- **Atomic application.** `LedgerService.applyTransaction` validates the whole transaction (existence, balance, positive amounts) *before* mutating any account. On any failure, no balance is touched.
- **Single-process, single-threaded.** Node's event loop already serializes the in-memory mutations, so no locks are needed. Under a real database, `LedgerService.applyTransaction` is the one place that would acquire a row-lock or open a SQL transaction.
- **Module exports are minimal.** `AccountsModule` exports its service and the repository token (the latter so `LedgerService` can inject it). The concrete in-memory class is private to the module.

## Decisions

- **Negative balances are allowed.** The spec defines direction updates but doesn't forbid going below zero, and a credit-direction "balance" of $0 still has well-defined semantics under our rules. An overdraft guard would slot into `LedgerService.applyTransaction` between the balance computation and the commit.
- **Initial balance must be ≥ 0** (`@Min(0)` on `CreateAccountDto.balance`). Opening with debt requires a transaction to record why; the create-then-immediately-broken-invariant case felt worse than the rejection. Easy to relax.
- **Zero-amount entries are rejected** (`@IsPositive()` on `EntryDto.amount`). They'd pass `isBalanced` trivially but carry no economic meaning, rejected for cleanliness.
- **Empty and single-entry transactions are rejected** at the DTO layer (`@ArrayMinSize(2)`). With strictly-positive amounts a single entry can never balance, so we fail fast with a clear validation error rather than letting the balance check produce a less specific message.
- **Multiple entries on the same `account_id` are allowed.** Useful for fee splits and similar patterns; the per-account accumulator in `LedgerService.applyTransaction` applies them in order.
- **Duplicate entry ids within a single transaction are not rejected.** Currently harmless because entries are nested under transactions and never looked up independently. If we add a `GET /transactions/:id/entries/:entry_id` later, that's the seam where uniqueness would start to matter.
- **`amount` must be a JSON number, not a numeric string.** `class-validator`'s `@IsNumber` enforces this, we set `transform: true` on the global `ValidationPipe` but deliberately did **not** enable `enableImplicitConversion`. Strict type contract over best-effort coercion.
- **Caller-supplied ids are non-empty strings, not necessarily UUID v4.** The spec says ids are "generated on object creation" if absent but doesn't constrain the format when supplied. Forcing UUID v4 would block legitimate business-key patterns like `acc-customer-42`. All four id fields (`account.id`, `transaction.id`, `entry.id`, `entry.account_id`) use `@IsString() @IsNotEmpty()`. Generated ids are still UUID v4. Easy to tighten back to `@IsUUID(4)` if the team wants the stricter contract. I would personally prefer to use https://github.com/jetify-com/typeid-js.
- **No upper bound on `entries` array size or `amount` magnitude.** `Number.MAX_SAFE_INTEGER` ≈ 9 × 10¹⁵ cents (~$90T) so integer overflow is theoretical for USD. An `@ArrayMaxSize(N)` and an explicit body-size limit are cheap DoS defences worth adding before exposing this on the open internet, see `Production readiness` for the broader API hardening list. Skipped in v1 to avoid an arbitrary bound this small surface doesn't yet need.
- **Repository errors are translated at the service boundary.** Repos throw typed `DuplicateIdError` / `EntityNotFoundError` (Nest-agnostic, defined in `src/common/repository-errors.ts`); services catch and re-throw as `ConflictException` / `NotFoundException`. Keeps `domain/` and storage-layer code free of `@nestjs/common` while preserving correct HTTP status codes if a future async backend ever races a service-level pre-check.
- **`name` is omitted from responses when absent** rather than emitted as `null`. Mappers branch on `account.name !== undefined` explicitly so the wire contract is a deliberate "field present iff set", not an accident of `JSON.stringify` dropping `undefined` keys.

## Extending this code

The plan was shaped to make these likely follow-ups straightforward:

| Likely ask                                     | Where it plugs in                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Swap in a real database                        | New `Postgres*Repository` implementing the interface; rebind the DI token in the module's providers. |
| List / paginate accounts or transactions       | Add `findAll(query)` to the repository interface + a controller route through the service.           |
| `GET /transactions/:id`                        | Repository already has `findById`; expose a controller route through `LedgerService`.                |
| Reverse / void a transaction                   | New `LedgerService.reverseTransaction(id)` — build the inverse entries, reuse the apply path.        |
| Pending vs. posted states                      | Add `status` to `Transaction`; existing `applyTransaction` becomes the "post" path.                  |
| Idempotency keys                               | Honor caller-supplied `id` already; add an `Idempotency-Key` header → key→response cache interceptor. |
| Multi-currency                                 | `amount` becomes `{ amount, currency }`; `isBalanced` enforces per-currency balance.                 |
| Concurrency under a real DB                    | `LedgerService.applyTransaction` is the single seam, wrap it in a SQL transaction or row-lock.       |
| Standardized error codes / `{ error: { … } }`  | One global `ExceptionFilter`. The error-message strings already carry enough information to map.      |
| Audit log / event stream                       | Emit from `LedgerService.applyTransaction` after a successful apply.                                  |

## Future improvements

A running list of operational and tooling upgrades.

### Environment variables

Currently the project uses a plain `.env` file loaded via `dotenv`. Once we have multiple environments and any actual secrets, the upgrade is [dotenvx](https://github.com/dotenvx/dotenvx) for environment variable management. Encrypted environment files are committed to git, secrets are never stored in plain text.

To update a local env var: `npx dotenvx set -f .env.local MY_VAR "value"`

### Persistence via TypeORM

Today entities are plain interfaces and repositories are `Map`-backed. For any real deployment this needs persistence. [TypeORM](https://typeorm.io/) via [`@nestjs/typeorm`](https://docs.nestjs.com/techniques/database) we deliberately shaped the code around repository interfaces so this is a one-file change per module.

What changes:

- **Entities** become decorator-annotated classes (`@Entity`, `@Column`, `@PrimaryColumn`, plus `@OneToMany` from `Transaction` to `Entry`) instead of plain interfaces.
- **Repositories** swap to `*.repository.typeorm.ts` files wrapping TypeORM's `Repository<T>`, still implementing the existing interface contracts.
- **Module wiring** rebinds the repository DI token to the TypeORM-backed class — env-switched so tests can stay on the in-memory implementation.
- **`LedgerService.applyTransaction`** wraps its body in `dataSource.transaction(...)` so atomicity moves from "Node's event loop serializes us" down to the SQL layer.

What stays the same: the repository interfaces, all services / controllers / DTOs / mappers, the pure `domain/` layer, and the unit-test suite — services keep being exercised against the in-memory repos in tests.

Alternative: [Prisma](https://www.prisma.io/) covers the same ground with a schema-first style. The repository-interface seam works for either; picking between them is a separate decision.

### Logging

Right now we lean on Nest's default `Logger` and don't actually emit anything from our own services, the lines you see at startup come from the framework. 

- **Structured JSON logs** via [`nestjs-pino`](https://github.com/iamolegga/nestjs-pino). Single-line JSON drops straight into Loki / Datadog / CloudWatch with no parsing layer, and it's fast enough that production logging stops being a measurable cost.
- **Per-service loggers** (`private readonly logger = new Logger(SomeService.name)`), starting with `LedgerService.applyTransaction` — entry ids in, account ids and resulting balances out.
- **Request correlation** middleware: attach a request id (from `X-Request-ID` if provided, otherwise generated) and thread it through pino's child loggers. Turns "trace this user's transaction" into a single grep.
- **Log level via env**: `LOG_LEVEL=debug|info|warn|error`, fed from the env-vars setup above. Production at `info`, dev at `debug`.
- **Audit trail**: same emission point as logging — `LedgerService.applyTransaction` publishes a structured `transaction.applied` event after commit. Logging and auditing share the seam.

Architectural fit: services inject the logger via the constructor — same DI pattern as everything else, no surgery elsewhere.

Alternative: [`nest-winston`](https://github.com/gremo/nest-winston) covers the same ground with multiple transports. Pino is leaner; Winston is more flexible. The injection seam is the same.

## Production readiness

These are the areas I would tackle if this were a real service.

**1. Persistence and consistency** ([details](#persistence-via-typeorm))
Real database, schema migrations, indexes (especially on `Entry.accountId` for account history). Atomicity moves from "Node serializes us" down to a SQL transaction wrapping `LedgerService.applyTransaction`, with row-level locking on the accounts being mutated so two parallel workers can't double-apply.

**2. Authentication and authorization**
None today. Production needs auth at the controller boundary (API keys for service-to-service, OAuth/JWT for human users) and a notion of *ownership*: callers should only act on their own accounts. Multi-tenancy implies a `tenantId` on the entities and an interceptor scoping every repository query.

**3. Idempotency for safe retries**
Caller-supplied `id` already gives us idempotency *for new resources* (a duplicate `POST /transactions` returns 409 today). For retries on transient failures we'd add an `Idempotency-Key` request header backed by a key→response cache (Redis), so a retried call returns the original result without re-applying balances.

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
- **Daily reconciliation job** asserting the global invariant, the signed sum across every account stays constant — alerting on drift.
- **Retention policy** (financial systems often require 7+ years) with a PII-deletion path that scrubs personal fields without breaking audit immutability.

**8. Money handling at scale**

- **Multi-currency** ([already noted](#extending-this-code)), `amount` becomes `{ amount, currency }`; `isBalanced` enforced per currency.
- **Higher precision** for currencies / contexts that need more than two decimal places. Either currency-specific scale factors over our cents helper, or move to `dinero.js` / `decimal.js` for arbitrary precision.

**9. Testing depth**

- **Property-based tests** ([`fast-check`](https://github.com/dubzzz/fast-check)) for ledger invariants — for any random sequence of valid transactions, the signed sum across all accounts stays constant.
- **Load tests** (k6, Artillery) once a real DB is in.
- **Contract tests** against the generated OpenAPI spec for any downstream consumers.

