import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
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
    // Reproduces the take-home spec's example payload verbatim. Hard-coded on
    // purpose — this test is the contract check against the spec's wire format.
    it('creates an account matching the spec example response', async () => {
      const res = await request(app.getHttpServer())
        .post('/accounts')
        .send({
          name: 'test3',
          direction: 'debit',
          id: '71cde2aa-b9bc-496a-a6f1-34964d05e6fd',
        })
        .expect(201);

      expect(res.body).toEqual({
        balance: 0,
        direction: 'debit',
        id: '71cde2aa-b9bc-496a-a6f1-34964d05e6fd',
        name: 'test3',
      });
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
      for (const entry of tx.body.entries) {
        expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(entry.amount).toBe(100);
        expect(['debit', 'credit']).toContain(entry.direction);
        expect([a.id, b.id]).toContain(entry.account_id);
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
});
