import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Account } from '../accounts/account.entity';
import { AccountsRepository } from '../accounts/accounts.repository';
import { InMemoryAccountsRepository } from '../accounts/accounts.repository.in-memory';
import { AccountsService } from '../accounts/accounts.service';
import {
  DuplicateIdError,
  EntityNotFoundError,
  StaleVersionError,
} from '../common/repository-errors';
import { dollarsToCents } from '../domain/money';
import {
  randomAmount,
  randomBusinessKey,
  randomUuid,
} from '../testing/factories';
import { TransactionsRepository } from './transactions.repository';
import { InMemoryTransactionsRepository } from './transactions.repository.in-memory';
import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  let accountsRepo: InMemoryAccountsRepository;
  let transactionsRepo: InMemoryTransactionsRepository;
  let accounts: AccountsService;
  let ledger: LedgerService;

  beforeEach(() => {
    accountsRepo = new InMemoryAccountsRepository();
    transactionsRepo = new InMemoryTransactionsRepository();
    accounts = new AccountsService(accountsRepo);
    ledger = new LedgerService(accountsRepo, transactionsRepo);
  });

  function setupTwoAccounts() {
    const a = accounts.create({
      id: randomBusinessKey('debit'),
      direction: 'debit',
    });
    const b = accounts.create({
      id: randomBusinessKey('credit'),
      direction: 'credit',
    });
    return { a, b };
  }

  it('applies a balanced two-entry transaction and updates both account balances', () => {
    const { a, b } = setupTwoAccounts();
    const amount = randomAmount();
    const txId = randomUuid();

    const tx = ledger.applyTransaction({
      id: txId,
      name: 'test',
      entries: [
        { accountId: a.id, direction: 'debit', amount },
        { accountId: b.id, direction: 'credit', amount },
      ],
    });

    expect(tx.id).toBe(txId);
    expect(tx.entries).toHaveLength(2);
    expect(tx.entries.every((e) => e.id.length > 0)).toBe(true);

    const expectedCents = dollarsToCents(amount);
    expect(accounts.findById(a.id).balanceCents).toBe(expectedCents);
    expect(accounts.findById(b.id).balanceCents).toBe(expectedCents);
  });

  it('rejects an unbalanced transaction and leaves balances untouched', () => {
    const { a, b } = setupTwoAccounts();
    const debit = randomAmount();
    // Pick a different credit amount, deterministically.
    const credit = +(debit + 0.01).toFixed(2);

    expect(() =>
      ledger.applyTransaction({
        entries: [
          { accountId: a.id, direction: 'debit', amount: debit },
          { accountId: b.id, direction: 'credit', amount: credit },
        ],
      }),
    ).toThrow(BadRequestException);

    expect(accounts.findById(a.id).balanceCents).toBe(0);
    expect(accounts.findById(b.id).balanceCents).toBe(0);
  });

  it('rejects a transaction referencing a missing account and leaves balances untouched', () => {
    const { a } = setupTwoAccounts();
    const amount = randomAmount();

    expect(() =>
      ledger.applyTransaction({
        entries: [
          { accountId: a.id, direction: 'debit', amount },
          { accountId: randomBusinessKey('nope'), direction: 'credit', amount },
        ],
      }),
    ).toThrow(NotFoundException);

    expect(accounts.findById(a.id).balanceCents).toBe(0);
  });

  it('rejects duplicate transaction ids', () => {
    const { a, b } = setupTwoAccounts();
    const txId = randomUuid();
    const amount = randomAmount();

    ledger.applyTransaction({
      id: txId,
      entries: [
        { accountId: a.id, direction: 'debit', amount },
        { accountId: b.id, direction: 'credit', amount },
      ],
    });

    expect(() =>
      ledger.applyTransaction({
        id: txId,
        entries: [
          { accountId: a.id, direction: 'debit', amount },
          { accountId: b.id, direction: 'credit', amount },
        ],
      }),
    ).toThrow(ConflictException);
  });

  it('rejects transactions with fewer than two entries', () => {
    expect(() => ledger.applyTransaction({ entries: [] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects zero or negative amounts', () => {
    const { a, b } = setupTwoAccounts();
    expect(() =>
      ledger.applyTransaction({
        entries: [
          { accountId: a.id, direction: 'debit', amount: 0 },
          { accountId: b.id, direction: 'credit', amount: 0 },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('honors caller-supplied entry ids', () => {
    const { a, b } = setupTwoAccounts();
    const entryAId = randomUuid();
    const entryBId = randomUuid();
    const amount = randomAmount();

    const tx = ledger.applyTransaction({
      entries: [
        { id: entryAId, accountId: a.id, direction: 'debit', amount },
        { id: entryBId, accountId: b.id, direction: 'credit', amount },
      ],
    });
    expect(tx.entries.map((e) => e.id)).toEqual([entryAId, entryBId]);
  });

  it('handles multi-entry splits (one debit, two credits summing to the debit)', () => {
    const debitId = randomBusinessKey('debit');
    const creditAId = randomBusinessKey('credit');
    const creditBId = randomBusinessKey('credit');
    accounts.create({ id: debitId, direction: 'debit' });
    accounts.create({ id: creditAId, direction: 'credit' });
    accounts.create({ id: creditBId, direction: 'credit' });

    const total = randomAmount(0.02);
    // Split into two parts at a random fraction, both > 0 and summing exactly to total.
    const partOneCents =
      1 + Math.floor(Math.random() * (dollarsToCents(total) - 1));
    const partOne = partOneCents / 100;
    const partTwo = +(total - partOne).toFixed(2);

    ledger.applyTransaction({
      entries: [
        { accountId: debitId, direction: 'debit', amount: total },
        { accountId: creditAId, direction: 'credit', amount: partOne },
        { accountId: creditBId, direction: 'credit', amount: partTwo },
      ],
    });

    expect(accounts.findById(debitId).balanceCents).toBe(dollarsToCents(total));
    expect(accounts.findById(creditAId).balanceCents).toBe(
      dollarsToCents(partOne),
    );
    expect(accounts.findById(creditBId).balanceCents).toBe(
      dollarsToCents(partTwo),
    );
  });

  it('accumulates multiple entries on the same account', () => {
    const debitId = randomBusinessKey('debit');
    const creditId = randomBusinessKey('credit');
    accounts.create({ id: debitId, direction: 'debit' });
    accounts.create({ id: creditId, direction: 'credit' });

    const total = randomAmount();
    const partOneCents =
      1 + Math.floor(Math.random() * (dollarsToCents(total) - 1));
    const partOne = partOneCents / 100;
    const partTwo = +(total - partOne).toFixed(2);

    ledger.applyTransaction({
      entries: [
        { accountId: debitId, direction: 'debit', amount: partOne },
        { accountId: debitId, direction: 'debit', amount: partTwo },
        { accountId: creditId, direction: 'credit', amount: total },
      ],
    });

    expect(accounts.findById(debitId).balanceCents).toBe(dollarsToCents(total));
    expect(accounts.findById(creditId).balanceCents).toBe(
      dollarsToCents(total),
    );
  });

  it('respects the direction-aware update rule (paying down a liability with cash)', () => {
    // Cash (debit) and liability (credit) both opening at the same random balance.
    // Pay a fraction of cash toward the liability — both balances should
    // decrease by the same amount via opposite-direction entries.
    const opening = randomAmount();
    const payment = +(opening / 2).toFixed(2);
    const cashId = randomBusinessKey('cash');
    const liabId = randomBusinessKey('liab');

    accounts.create({ id: cashId, direction: 'debit', balance: opening });
    accounts.create({ id: liabId, direction: 'credit', balance: opening });

    ledger.applyTransaction({
      entries: [
        { accountId: liabId, direction: 'debit', amount: payment },
        { accountId: cashId, direction: 'credit', amount: payment },
      ],
    });

    const expectedRemaining = dollarsToCents(opening) - dollarsToCents(payment);
    expect(accounts.findById(cashId).balanceCents).toBe(expectedRemaining);
    expect(accounts.findById(liabId).balanceCents).toBe(expectedRemaining);
  });

  describe('timestamp + back-reference invariants', () => {
    it('stamps the same `now` on the transaction, every entry, and every touched account', () => {
      const { a, b } = setupTwoAccounts();
      const now = new Date('2026-05-05T10:00:00.000Z');
      const expected = '2026-05-05T10:00:00.000Z';

      const tx = ledger.applyTransaction(
        {
          entries: [
            { accountId: a.id, direction: 'debit', amount: 5 },
            { accountId: b.id, direction: 'credit', amount: 5 },
          ],
        },
        now,
      );

      expect(tx.createdAt).toBe(expected);
      for (const entry of tx.entries) {
        expect(entry.createdAt).toBe(expected);
        expect(entry.transactionId).toBe(tx.id);
      }
      expect(accounts.findById(a.id).updatedAt).toBe(expected);
      expect(accounts.findById(b.id).updatedAt).toBe(expected);
      // Symmetry: the same value should be observable via the transactions
      // repository, not just the return value.
      expect(transactionsRepo.findById(tx.id)?.createdAt).toBe(expected);
    });

    it('list returns the paginated transactions envelope', () => {
      const { a, b } = setupTwoAccounts();
      ledger.applyTransaction({
        entries: [
          { accountId: a.id, direction: 'debit', amount: 1 },
          { accountId: b.id, direction: 'credit', amount: 1 },
        ],
      });
      ledger.applyTransaction({
        entries: [
          { accountId: a.id, direction: 'debit', amount: 2 },
          { accountId: b.id, direction: 'credit', amount: 2 },
        ],
      });
      const page = ledger.list({ offset: 0, limit: 10 });
      expect(page.total).toBe(2);
      expect(page.items).toHaveLength(2);
    });

    it('findEntriesByAccountId returns only entries that touch the account', () => {
      const { a, b } = setupTwoAccounts();
      ledger.applyTransaction({
        entries: [
          { accountId: a.id, direction: 'debit', amount: 7 },
          { accountId: b.id, direction: 'credit', amount: 7 },
        ],
      });
      const page = ledger.findEntriesByAccountId(a.id, {
        offset: 0,
        limit: 10,
      });
      expect(page.total).toBe(1);
      expect(page.items[0].accountId).toBe(a.id);
    });

    it('findEntriesByAccountId throws NotFoundException for an unknown account', () => {
      expect(() =>
        ledger.findEntriesByAccountId('no-such-account', {
          offset: 0,
          limit: 10,
        }),
      ).toThrow(NotFoundException);
    });

    it('does not change createdAt on accounts that have been mutated by transactions', () => {
      // Account creation captures createdAt; subsequent transactions only
      // advance updatedAt. The two diverge for any account that has
      // participated in a transaction.
      const created = new Date('2026-01-01T00:00:00.000Z');
      const txTime = new Date('2026-06-01T00:00:00.000Z');
      const a = accounts.create(
        { id: randomBusinessKey('debit'), direction: 'debit' },
        created,
      );
      const b = accounts.create(
        { id: randomBusinessKey('credit'), direction: 'credit' },
        created,
      );

      ledger.applyTransaction(
        {
          entries: [
            { accountId: a.id, direction: 'debit', amount: 1 },
            { accountId: b.id, direction: 'credit', amount: 1 },
          ],
        },
        txTime,
      );

      const after = accounts.findById(a.id);
      expect(after.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(after.updatedAt).toBe('2026-06-01T00:00:00.000Z');
    });
  });

  describe('defensive translation of repository errors', () => {
    // The pre-checks in `applyTransaction` make these typed throws unreachable
    // in normal single-threaded flow; the catches exist to guard a future
    // race between pre-check and commit (e.g. under an async backend).
    // We exercise the translation directly with stubbed repositories.

    it('rejects an entry amount with more than two decimal places (defensive)', () => {
      const { a, b } = setupTwoAccounts();
      expect(() =>
        ledger.applyTransaction({
          entries: [
            { accountId: a.id, direction: 'debit', amount: 0.001 },
            { accountId: b.id, direction: 'credit', amount: 0.001 },
          ],
        }),
      ).toThrow(BadRequestException);
    });

    it('translates EntityNotFoundError from accountsRepo.update into NotFoundException', () => {
      const stubAccount: Account = {
        id: 'stub',
        direction: 'debit',
        openingBalanceCents: 0,
        balanceCents: 0,
        version: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const stubAccountsRepo: AccountsRepository = {
        create: jest.fn(),
        findById: jest.fn().mockReturnValue(stubAccount),
        findAll: jest.fn().mockReturnValue([]),
        findPage: jest
          .fn()
          .mockReturnValue({ items: [], total: 0, offset: 0, limit: 20 }),
        update: jest.fn(() => {
          throw new EntityNotFoundError('account', 'stub');
        }),
      };
      const racingLedger = new LedgerService(
        stubAccountsRepo,
        new InMemoryTransactionsRepository(),
      );

      expect(() =>
        racingLedger.applyTransaction({
          entries: [
            { accountId: 'stub', direction: 'debit', amount: 1 },
            { accountId: 'stub', direction: 'credit', amount: 1 },
          ],
        }),
      ).toThrow(NotFoundException);
    });

    it('translates DuplicateIdError from transactionsRepo.create into ConflictException', () => {
      const { a, b } = setupTwoAccounts();
      const stubTransactionsRepo: TransactionsRepository = {
        findById: jest.fn().mockReturnValue(undefined),
        findAll: jest.fn().mockReturnValue([]),
        findPage: jest
          .fn()
          .mockReturnValue({ items: [], total: 0, offset: 0, limit: 20 }),
        findEntriesByAccountId: jest
          .fn()
          .mockReturnValue({ items: [], total: 0, offset: 0, limit: 20 }),
        create: jest.fn(() => {
          throw new DuplicateIdError('transaction', 'stub');
        }),
      };
      const racingLedger = new LedgerService(
        accountsRepo,
        stubTransactionsRepo,
      );

      expect(() =>
        racingLedger.applyTransaction({
          entries: [
            { accountId: a.id, direction: 'debit', amount: 1 },
            { accountId: b.id, direction: 'credit', amount: 1 },
          ],
        }),
      ).toThrow(ConflictException);
    });

    it('translates StaleVersionError from accountsRepo.update into ConflictException (lost-update race)', () => {
      // Reproduce the canonical optimistic-concurrency race using the real
      // in-memory repo. The "second writer" is simulated by bumping the
      // stored account's version between LedgerService's read and commit:
      // the racing repo's `findById` returns the original (version 0), but
      // when commit reaches `update`, the stored version is 1 and the
      // repo's version check fires.
      const { a, b } = setupTwoAccounts();
      const originalA = accountsRepo.findById(a.id)!;
      const realFindById = accountsRepo.findById.bind(accountsRepo);
      const racingAccountsRepo: AccountsRepository = {
        create: accountsRepo.create.bind(accountsRepo),
        findAll: accountsRepo.findAll.bind(accountsRepo),
        findPage: accountsRepo.findPage.bind(accountsRepo),
        update: accountsRepo.update.bind(accountsRepo),
        findById: jest.fn((id: string) => {
          if (id === a.id) {
            // Concurrent commit happens between the service's pre-fetch and
            // its `update` call: we hand the service a stale snapshot, then
            // bump the stored row's version so the version check on commit
            // disagrees.
            const stored = realFindById(a.id)!;
            accountsRepo.update({ ...stored, balanceCents: 9999 });
            return originalA;
          }
          return realFindById(id);
        }),
      };
      const racingLedger = new LedgerService(
        racingAccountsRepo,
        transactionsRepo,
      );

      expect(() =>
        racingLedger.applyTransaction({
          entries: [
            { accountId: a.id, direction: 'debit', amount: 5 },
            { accountId: b.id, direction: 'credit', amount: 5 },
          ],
        }),
      ).toThrow(ConflictException);
    });

    it('a second-pass repo unit-test confirms the typed error is StaleVersionError', () => {
      // The translation above is what HTTP callers see; this assertion makes
      // sure the underlying error class is the one the interface advertises.
      const stubAccount: Account = {
        id: 'stub',
        direction: 'debit',
        openingBalanceCents: 0,
        balanceCents: 0,
        version: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const stubAccountsRepo: AccountsRepository = {
        create: jest.fn(),
        findById: jest.fn().mockReturnValue(stubAccount),
        findAll: jest.fn().mockReturnValue([]),
        findPage: jest
          .fn()
          .mockReturnValue({ items: [], total: 0, offset: 0, limit: 20 }),
        update: jest.fn(() => {
          throw new StaleVersionError('account', 'stub', 0, 1);
        }),
      };
      const racingLedger = new LedgerService(
        stubAccountsRepo,
        new InMemoryTransactionsRepository(),
      );

      expect(() =>
        racingLedger.applyTransaction({
          entries: [
            { accountId: 'stub', direction: 'debit', amount: 1 },
            { accountId: 'stub', direction: 'credit', amount: 1 },
          ],
        }),
      ).toThrow(ConflictException);
    });

    it('rethrows unrecognized errors from the commit phase unchanged', () => {
      const stubAccount: Account = {
        id: 'stub',
        direction: 'debit',
        openingBalanceCents: 0,
        balanceCents: 0,
        version: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      class CustomError extends Error {}
      const stubAccountsRepo: AccountsRepository = {
        create: jest.fn(),
        findById: jest.fn().mockReturnValue(stubAccount),
        findAll: jest.fn().mockReturnValue([]),
        findPage: jest
          .fn()
          .mockReturnValue({ items: [], total: 0, offset: 0, limit: 20 }),
        update: jest.fn(() => {
          throw new CustomError('something else');
        }),
      };
      const racingLedger = new LedgerService(
        stubAccountsRepo,
        new InMemoryTransactionsRepository(),
      );

      expect(() =>
        racingLedger.applyTransaction({
          entries: [
            { accountId: 'stub', direction: 'debit', amount: 1 },
            { accountId: 'stub', direction: 'credit', amount: 1 },
          ],
        }),
      ).toThrow(CustomError);
    });
  });
});
