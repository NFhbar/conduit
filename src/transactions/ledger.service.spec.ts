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
        balanceCents: 0,
      };
      const stubAccountsRepo: AccountsRepository = {
        create: jest.fn(),
        findById: jest.fn().mockReturnValue(stubAccount),
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

    it('rethrows unrecognized errors from the commit phase unchanged', () => {
      const stubAccount: Account = {
        id: 'stub',
        direction: 'debit',
        balanceCents: 0,
      };
      class CustomError extends Error {}
      const stubAccountsRepo: AccountsRepository = {
        create: jest.fn(),
        findById: jest.fn().mockReturnValue(stubAccount),
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
