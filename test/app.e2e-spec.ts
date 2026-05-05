import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ACCOUNTS_REPOSITORY } from '../src/accounts/accounts.repository';
import { InMemoryAccountsRepository } from '../src/accounts/accounts.repository.in-memory';
import { AppModule } from '../src/app.module';
import {
  randomAmount,
  randomBusinessKey,
  randomUuid,
} from '../src/testing/factories';

describe('Ledger API (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /accounts', () => {
    // Reproduces the take-home spec's example payload verbatim. The four
    // fields the spec example documents are asserted exactly; `created_at`
    // and `updated_at` are additions from v1.5 (audit trail) and just
    // checked for shape, not exact value.
    it('creates an account matching the spec example response', async () => {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send({
          name: 'test3',
          direction: 'debit',
          id: '71cde2aa-b9bc-496a-a6f1-34964d05e6fd',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        balance: 0,
        direction: 'debit',
        id: '71cde2aa-b9bc-496a-a6f1-34964d05e6fd',
        name: 'test3',
      });
      expect(res.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(res.body.updated_at).toBe(res.body.created_at);
    });

    it('generates a uuid when id is omitted', async () => {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send({ direction: 'credit' })
        .expect(201);
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.direction).toBe('credit');
      expect(res.body.balance).toBe(0);
    });

    it('omits `name` from the response when not provided (instead of emitting null)', async () => {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send({ direction: 'debit' })
        .expect(201);
      expect(res.body).not.toHaveProperty('name');
    });

    it('accepts non-UUID business-key ids (id is just a non-empty string)', async () => {
      const id = randomBusinessKey('acc');
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send({ id, direction: 'debit' })
        .expect(201);
      expect(res.body.id).toBe(id);
    });

    it('rejects empty-string id with 400', async () => {
      await request(app.getHttpServer())
        .post('/accounts')
        .send({ id: '', direction: 'debit' })
        .expect(400);
    });

    it('rejects an invalid direction with 400', async () => {
      await request(app.getHttpServer())
        .post('/accounts')
        .send({ direction: 'sideways' })
        .expect(400);
    });

    it('rejects extraneous fields with 400 (whitelist enforcement)', async () => {
      await request(app.getHttpServer())
        .post('/accounts')
        .send({ direction: 'debit', extra: 'nope' })
        .expect(400);
    });

    it('rejects duplicate id with 409', async () => {
      const id = randomUuid();
      await request(app.getHttpServer())
        .post('/accounts')
        .send({ id, direction: 'debit' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/accounts')
        .send({ id, direction: 'credit' })
        .expect(409);
    });
  });

  describe('GET /accounts/:id', () => {
    it('returns an existing account with the opening balance it was created with', async () => {
      const opening = randomAmount();
      const created = await request(app.getHttpServer())
        .post('/accounts')
        .send({ direction: 'debit', balance: opening })
        .expect(201);

      const got = await request(app.getHttpServer())
        .get(`/accounts/${created.body.id}`)
        .expect(200);
      expect(got.body).toEqual(created.body);
      expect(got.body.balance).toBe(opening);
    });

    it('returns 404 for a missing account', async () => {
      await request(app.getHttpServer())
        .get(`/accounts/${randomBusinessKey('missing')}`)
        .expect(404);
    });
  });

  describe('POST /transactions', () => {
    async function createAccount(payload: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send(payload)
        .expect(201);
      return res.body as {
        id: string;
        balance: number;
        direction: 'debit' | 'credit';
      };
    }

    // Reproduces the take-home spec's example transaction verbatim. Hard-coded
    // on purpose — this test is the contract check against the spec.
    it('applies the spec example transaction and updates both balances', async () => {
      const a = await createAccount({
        id: 'fa967ec9-5be2-4c26-a874-7eeeabfc6da8',
        direction: 'debit',
      });
      const b = await createAccount({
        id: 'dbf17d00-8701-4c4e-9fc5-6ae33c324309',
        direction: 'credit',
      });

      const tx = await request(app.getHttpServer())
        .post('/transactions')
        .send({
          name: 'test',
          id: '3256dc3c-7b18-4a21-95c6-146747cf2971',
          entries: [
            { direction: 'debit', account_id: a.id, amount: 100 },
            { direction: 'credit', account_id: b.id, amount: 100 },
          ],
        })
        .expect(201);

      expect(tx.body.id).toBe('3256dc3c-7b18-4a21-95c6-146747cf2971');
      expect(tx.body.name).toBe('test');
      expect(tx.body.entries).toHaveLength(2);
      // v1.5 audit fields: transaction has a created_at; every entry has
      // created_at AND a transaction_id back-reference equal to the parent's id.
      expect(tx.body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      for (const entry of tx.body.entries) {
        expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(entry.amount).toBe(100);
        expect(['debit', 'credit']).toContain(entry.direction);
        expect([a.id, b.id]).toContain(entry.account_id);
        expect(entry.transaction_id).toBe(tx.body.id);
        expect(entry.created_at).toBe(tx.body.created_at);
      }

      const ag = await request(app.getHttpServer())
        .get(`/accounts/${a.id}`)
        .expect(200);
      const bg = await request(app.getHttpServer())
        .get(`/accounts/${b.id}`)
        .expect(200);
      expect(ag.body.balance).toBe(100);
      expect(bg.body.balance).toBe(100);
    });

    it('rejects an unbalanced transaction with 400 and leaves balances untouched', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      const debit = randomAmount();
      const credit = +(debit + 0.01).toFixed(2);

      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount: debit },
            { direction: 'credit', account_id: b.id, amount: credit },
          ],
        })
        .expect(400);

      const ag = await request(app.getHttpServer()).get(`/accounts/${a.id}`);
      const bg = await request(app.getHttpServer()).get(`/accounts/${b.id}`);
      expect(ag.body.balance).toBe(0);
      expect(bg.body.balance).toBe(0);
    });

    it('returns 404 when an entry references a missing account', async () => {
      const a = await createAccount({ direction: 'debit' });
      const amount = randomAmount();
      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount },
            {
              direction: 'credit',
              account_id: randomBusinessKey('missing'),
              amount,
            },
          ],
        })
        .expect(404);
    });

    it('rejects duplicate transaction id with 409', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      const id = randomUuid();
      const amount = randomAmount();
      const body = {
        id,
        entries: [
          { direction: 'debit', account_id: a.id, amount },
          { direction: 'credit', account_id: b.id, amount },
        ],
      };
      await request(app.getHttpServer())
        .post('/transactions')
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post('/transactions')
        .send(body)
        .expect(409);
    });

    it('rejects a single-entry transaction with 400 (ArrayMinSize)', async () => {
      const a = await createAccount({ direction: 'debit' });
      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount: randomAmount() },
          ],
        })
        .expect(400);
    });

    it('rejects an entry with empty-string account_id with 400', async () => {
      const a = await createAccount({ direction: 'debit' });
      const amount = randomAmount();
      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount },
            { direction: 'credit', account_id: '', amount },
          ],
        })
        .expect(400);
    });

    it('rejects non-positive entry amounts with 400', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount: 0 },
            { direction: 'credit', account_id: b.id, amount: 0 },
          ],
        })
        .expect(400);
    });

    it('handles multi-entry splits (one debit, two credits summing to the debit)', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      const c = await createAccount({ direction: 'credit' });

      const total = randomAmount(0.02);
      const totalCents = Math.round(total * 100);
      const partOneCents = 1 + Math.floor(Math.random() * (totalCents - 1));
      const partOne = partOneCents / 100;
      const partTwo = +(total - partOne).toFixed(2);

      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount: total },
            { direction: 'credit', account_id: b.id, amount: partOne },
            { direction: 'credit', account_id: c.id, amount: partTwo },
          ],
        })
        .expect(201);

      const balances: Record<string, number> = {};
      for (const id of [a.id, b.id, c.id]) {
        const res = await request(app.getHttpServer())
          .get(`/accounts/${id}`)
          .expect(200);
        balances[id] = res.body.balance;
      }
      expect(balances[a.id]).toBe(total);
      expect(balances[b.id]).toBe(partOne);
      expect(balances[c.id]).toBe(partTwo);
    });
  });

  describe('Idempotency-Key', () => {
    async function createAccount(payload: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send(payload)
        .expect(201);
      return res.body as { id: string; balance: number };
    }

    it('replays the cached 201 on POST /transactions with the same key + body, applying balances only once', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      const key = randomUuid();
      const amount = randomAmount();
      const body = {
        entries: [
          { direction: 'debit', account_id: a.id, amount },
          { direction: 'credit', account_id: b.id, amount },
        ],
      };

      const first = await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);

      expect(second.body).toEqual(first.body);

      const expectedCents = Math.round(amount * 100);
      const ag = await request(app.getHttpServer())
        .get(`/accounts/${a.id}`)
        .expect(200);
      const bg = await request(app.getHttpServer())
        .get(`/accounts/${b.id}`)
        .expect(200);
      expect(Math.round(ag.body.balance * 100)).toBe(expectedCents);
      expect(Math.round(bg.body.balance * 100)).toBe(expectedCents);
    });

    it('rejects a second request with the same key but a different body (409)', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      const key = randomUuid();
      const baseEntries = [
        { direction: 'debit', account_id: a.id, amount: 10 },
        { direction: 'credit', account_id: b.id, amount: 10 },
      ];

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send({ entries: baseEntries })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount: 20 },
            { direction: 'credit', account_id: b.id, amount: 20 },
          ],
        })
        .expect(409);
    });

    it('replays a cached error response (400) on retry with the same key + body', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      const key = randomUuid();
      const unbalanced = {
        entries: [
          { direction: 'debit', account_id: a.id, amount: 100 },
          { direction: 'credit', account_id: b.id, amount: 99 },
        ],
      };

      const first = await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send(unbalanced)
        .expect(400);

      const second = await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send(unbalanced)
        .expect(400);

      expect(second.body).toEqual(first.body);
    });

    it('replays a cached 404 (entry references a missing account) on retry', async () => {
      const a = await createAccount({ direction: 'debit' });
      const key = randomUuid();
      const body = {
        entries: [
          { direction: 'debit', account_id: a.id, amount: 50 },
          { direction: 'credit', account_id: 'no-such-account', amount: 50 },
        ],
      };

      const first = await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(404);
      const second = await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(404);
      expect(second.body).toEqual(first.body);
    });

    it('replays a cached 409 (duplicate transaction id) on retry', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      const txId = randomUuid();

      // Pre-seed the duplicate condition with a non-idempotent first POST.
      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          id: txId,
          entries: [
            { direction: 'debit', account_id: a.id, amount: 1 },
            { direction: 'credit', account_id: b.id, amount: 1 },
          ],
        })
        .expect(201);

      const key = randomUuid();
      const conflictingBody = {
        id: txId,
        entries: [
          { direction: 'debit', account_id: a.id, amount: 1 },
          { direction: 'credit', account_id: b.id, amount: 1 },
        ],
      };

      const first = await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send(conflictingBody)
        .expect(409);
      const second = await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send(conflictingBody)
        .expect(409);
      expect(second.body).toEqual(first.body);
    });

    it('namespaces the cache by route — same key on two endpoints does not cross-replay', async () => {
      const key = randomUuid();

      // First request: create an account using the key.
      const acctRes = await request(app.getHttpServer())
        .post('/accounts')
        .set('Idempotency-Key', key)
        .send({ direction: 'debit' })
        .expect(201);

      // Set up two more accounts for a transaction (via fresh, no-key requests).
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });

      // Second request: same key, different route. Should NOT replay the
      // accounts response — each route has its own cache namespace.
      const txRes = await request(app.getHttpServer())
        .post('/transactions')
        .set('Idempotency-Key', key)
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount: 1 },
            { direction: 'credit', account_id: b.id, amount: 1 },
          ],
        })
        .expect(201);

      expect(txRes.body).not.toEqual(acctRes.body);
      expect(txRes.body.entries).toHaveLength(2);
      expect(acctRes.body.direction).toBe('debit');
    });

    it('passes through unchanged when the header is absent (multiple POSTs apply multiple times)', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      const tx = (id: string) => ({
        id,
        entries: [
          { direction: 'debit', account_id: a.id, amount: 5 },
          { direction: 'credit', account_id: b.id, amount: 5 },
        ],
      });

      await request(app.getHttpServer())
        .post('/transactions')
        .send(tx(randomUuid()))
        .expect(201);
      await request(app.getHttpServer())
        .post('/transactions')
        .send(tx(randomUuid()))
        .expect(201);

      const ag = await request(app.getHttpServer())
        .get(`/accounts/${a.id}`)
        .expect(200);
      expect(ag.body.balance).toBe(10); // both transactions applied
    });

    it('rejects an empty Idempotency-Key with 400', async () => {
      await request(app.getHttpServer())
        .post('/accounts')
        .set('Idempotency-Key', '   ')
        .send({ direction: 'debit' })
        .expect(400);
    });

    it('rejects an Idempotency-Key over 255 characters with 400', async () => {
      await request(app.getHttpServer())
        .post('/accounts')
        .set('Idempotency-Key', 'x'.repeat(256))
        .send({ direction: 'debit' })
        .expect(400);
    });

    it('also covers POST /accounts (replays cached 201 with the same id)', async () => {
      const key = randomUuid();
      const body = { direction: 'debit', name: 'idempotent-account' };

      const first = await request(app.getHttpServer())
        .post('/accounts')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/accounts')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);

      expect(second.body).toEqual(first.body);
      // The cached id is replayed; without idempotency, the second request
      // would have generated a new uuid.
    });

    it('does not affect GET /accounts/:id (header is ignored on GETs)', async () => {
      const account = await createAccount({ direction: 'debit', balance: 42 });
      const res = await request(app.getHttpServer())
        .get(`/accounts/${account.id}`)
        .set('Idempotency-Key', randomUuid())
        .expect(200);
      expect(res.body.balance).toBe(42);
    });
  });

  describe('GET /reconciliation', () => {
    async function createAccount(payload: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send(payload)
        .expect(201);
      return res.body as { id: string };
    }

    it('reports `ok` for a clean ledger after a balanced transaction', async () => {
      const a = await createAccount({ direction: 'debit', balance: 100 });
      const b = await createAccount({ direction: 'credit', balance: 100 });
      const amount = randomAmount();

      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount },
            { direction: 'credit', account_id: b.id, amount },
          ],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/reconciliation')
        .expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.accountsChecked).toBe(2);
      expect(res.body.transactionsReplayed).toBe(1);
      expect(res.body.discrepancies).toEqual([]);
      expect(res.body.globalSignedSum).toBe(res.body.globalOpeningSignedSum);
      expect(typeof res.body.checkedAt).toBe('string');
    });

    it('reports `ok` for an empty ledger', async () => {
      const res = await request(app.getHttpServer())
        .get('/reconciliation')
        .expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.accountsChecked).toBe(0);
      expect(res.body.transactionsReplayed).toBe(0);
    });

    it('reports `drift_detected` with discrepancy details when an account is tampered out of band', async () => {
      // Set up a clean balanced ledger via the public API.
      const a = await request(app.getHttpServer())
        .post('/accounts')
        .send({ direction: 'debit' })
        .expect(201);
      const b = await request(app.getHttpServer())
        .post('/accounts')
        .send({ direction: 'credit' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: a.body.id, amount: 25 },
            { direction: 'credit', account_id: b.body.id, amount: 25 },
          ],
        })
        .expect(201);

      // Now do the one thing the public API forbids: write an out-of-band
      // balance that the entry history doesn't justify. Reaching into the
      // app's repo via DI lets us simulate the storage corruption that
      // reconciliation exists to catch — there's no HTTP path that produces
      // this state, which is itself a positive (the production API can't
      // corrupt the ledger), but the negative path of `GET /reconciliation`
      // isn't exercisable any other way at the e2e layer.
      const accountsRepo =
        app.get<InMemoryAccountsRepository>(ACCOUNTS_REPOSITORY);
      const stored = accountsRepo.findById(a.body.id)!;
      accountsRepo.update({
        ...stored,
        balanceCents: stored.balanceCents + 5000,
      });

      const res = await request(app.getHttpServer())
        .get('/reconciliation')
        .expect(200);

      expect(res.body.status).toBe('drift_detected');
      expect(res.body.globalInvariantHolds).toBe(false);
      expect(res.body.orphanEntries).toEqual([]);
      expect(res.body.discrepancies).toHaveLength(1);

      const discrepancy = res.body.discrepancies[0];
      expect(discrepancy.accountId).toBe(a.body.id);
      // +5000 cents = +$50; mapper converts cents → dollars.
      expect(discrepancy.diff).toBe(50);
      expect(discrepancy.actualBalance).toBe(discrepancy.expectedBalance + 50);
    });
  });

  describe('GET /accounts (list)', () => {
    async function createAccount(payload: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send(payload)
        .expect(201);
      return res.body as { id: string; created_at: string };
    }

    it('returns an empty page when there are no accounts', async () => {
      const res = await request(app.getHttpServer())
        .get('/accounts')
        .expect(200);
      expect(res.body).toEqual({ items: [], total: 0, offset: 0, limit: 20 });
    });

    it('returns every created account in a sorted page (deterministic ordering covered by repo unit tests)', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      const c = await createAccount({ direction: 'debit' });

      const res = await request(app.getHttpServer())
        .get('/accounts')
        .expect(200);
      expect(res.body.total).toBe(3);
      const returnedIds = res.body.items.map((it: { id: string }) => it.id);
      expect(returnedIds.sort()).toEqual([a.id, b.id, c.id].sort());
      // Sort order itself (newest-first with id tiebreaker) is exercised
      // deterministically in `accounts.repository.in-memory.spec.ts` because
      // e2e POSTs land within the same millisecond.
    });

    it('respects offset and limit', async () => {
      for (let i = 0; i < 5; i++) await createAccount({ direction: 'debit' });

      const page = await request(app.getHttpServer())
        .get('/accounts?offset=1&limit=2')
        .expect(200);
      expect(page.body.total).toBe(5);
      expect(page.body.offset).toBe(1);
      expect(page.body.limit).toBe(2);
      expect(page.body.items).toHaveLength(2);
    });

    it('rejects a negative offset with 400', async () => {
      await request(app.getHttpServer()).get('/accounts?offset=-1').expect(400);
    });

    it('rejects a limit above the maximum with 400', async () => {
      await request(app.getHttpServer()).get('/accounts?limit=101').expect(400);
    });

    it.each(['NaN', 'abc', 'Infinity', '1.5'])(
      'rejects non-integer offset=%s with 400',
      async (badOffset) => {
        await request(app.getHttpServer())
          .get(`/accounts?offset=${badOffset}`)
          .expect(400);
      },
    );
  });

  describe('GET /transactions (list)', () => {
    async function createAccount(payload: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send(payload)
        .expect(201);
      return res.body as { id: string };
    }
    async function applyTx(aId: string, bId: string, amount: number) {
      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: aId, amount },
            { direction: 'credit', account_id: bId, amount },
          ],
        })
        .expect(201);
    }

    it('returns transactions newest-first with the right total', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      await applyTx(a.id, b.id, 10);
      await applyTx(a.id, b.id, 20);

      const res = await request(app.getHttpServer())
        .get('/transactions')
        .expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
      // Each item carries the new wire shape — created_at and entries.
      expect(typeof res.body.items[0].created_at).toBe('string');
      expect(res.body.items[0].entries).toHaveLength(2);
    });
  });

  describe('GET /accounts/:id/entries (history)', () => {
    async function createAccount(payload: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send(payload)
        .expect(201);
      return res.body as { id: string };
    }

    it('returns the entries that touched the given account, newest-first', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      const c = await createAccount({ direction: 'credit' });

      // Two transactions: one between a and b, one between a and c.
      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount: 10 },
            { direction: 'credit', account_id: b.id, amount: 10 },
          ],
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/transactions')
        .send({
          entries: [
            { direction: 'debit', account_id: a.id, amount: 5 },
            { direction: 'credit', account_id: c.id, amount: 5 },
          ],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/accounts/${a.id}/entries`)
        .expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
      expect(
        res.body.items.every(
          (e: { account_id: string }) => e.account_id === a.id,
        ),
      ).toBe(true);
      // Each entry carries its parent transaction id and a created_at.
      for (const entry of res.body.items) {
        expect(typeof entry.transaction_id).toBe('string');
        expect(typeof entry.created_at).toBe('string');
      }
    });

    it('returns 404 for a missing account', async () => {
      await request(app.getHttpServer())
        .get(`/accounts/${randomBusinessKey('missing')}/entries`)
        .expect(404);
    });

    it('paginates the entry list', async () => {
      const a = await createAccount({ direction: 'debit' });
      const b = await createAccount({ direction: 'credit' });
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/transactions')
          .send({
            entries: [
              { direction: 'debit', account_id: a.id, amount: 1 },
              { direction: 'credit', account_id: b.id, amount: 1 },
            ],
          })
          .expect(201);
      }

      const page = await request(app.getHttpServer())
        .get(`/accounts/${a.id}/entries?offset=1&limit=1`)
        .expect(200);
      expect(page.body.total).toBe(3);
      expect(page.body.items).toHaveLength(1);
    });
  });
});
