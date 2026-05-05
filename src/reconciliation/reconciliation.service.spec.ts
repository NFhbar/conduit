import { InMemoryAccountsRepository } from '../accounts/accounts.repository.in-memory';
import { AccountsService } from '../accounts/accounts.service';
import {
  randomAmount,
  randomBusinessKey,
  randomUuid,
} from '../testing/factories';
import { dollarsToCents } from '../domain/money';
import { LedgerService } from '../transactions/ledger.service';
import { InMemoryTransactionsRepository } from '../transactions/transactions.repository.in-memory';
import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
  let accountsRepo: InMemoryAccountsRepository;
  let transactionsRepo: InMemoryTransactionsRepository;
  let accounts: AccountsService;
  let ledger: LedgerService;
  let service: ReconciliationService;

  beforeEach(() => {
    accountsRepo = new InMemoryAccountsRepository();
    transactionsRepo = new InMemoryTransactionsRepository();
    accounts = new AccountsService(accountsRepo);
    ledger = new LedgerService(accountsRepo, transactionsRepo);
    service = new ReconciliationService(accountsRepo, transactionsRepo);
  });

  it('reports `ok` for an empty ledger', () => {
    const report = service.reconcile();
    expect(report.status).toBe('ok');
    expect(report.accountsChecked).toBe(0);
    expect(report.transactionsReplayed).toBe(0);
    expect(report.discrepancies).toEqual([]);
    expect(report.orphanEntries).toEqual([]);
    expect(report.globalSignedSumCents).toBe(0);
    expect(report.globalOpeningSignedSumCents).toBe(0);
    expect(report.globalInvariantHolds).toBe(true);
  });

  it('reports `ok` after a sequence of balanced transactions, with all three invariants intact', () => {
    const a = accounts.create({
      id: randomBusinessKey('debit'),
      direction: 'debit',
      balance: 100,
    });
    const b = accounts.create({
      id: randomBusinessKey('credit'),
      direction: 'credit',
      balance: 100,
    });

    for (let i = 0; i < 5; i++) {
      const amount = randomAmount();
      ledger.applyTransaction({
        entries: [
          { accountId: a.id, direction: 'debit', amount },
          { accountId: b.id, direction: 'credit', amount },
        ],
      });
    }

    const report = service.reconcile();
    expect(report.status).toBe('ok');
    expect(report.accountsChecked).toBe(2);
    expect(report.transactionsReplayed).toBe(5);
    expect(report.discrepancies).toEqual([]);
    expect(report.orphanEntries).toEqual([]);
    expect(report.globalInvariantHolds).toBe(true);
    expect(report.globalSignedSumCents).toBe(
      report.globalOpeningSignedSumCents,
    );
  });

  it('detects drift when an account balance is mutated outside the ledger', () => {
    const a = accounts.create({
      id: randomBusinessKey('debit'),
      direction: 'debit',
    });
    const b = accounts.create({
      id: randomBusinessKey('credit'),
      direction: 'credit',
    });

    ledger.applyTransaction({
      entries: [
        { accountId: a.id, direction: 'debit', amount: 50 },
        { accountId: b.id, direction: 'credit', amount: 50 },
      ],
    });

    // Simulate corruption: write a balance that the entry history doesn't
    // justify. This is the exact failure mode reconciliation exists to catch.
    const stored = accountsRepo.findById(a.id)!;
    accountsRepo.update({
      ...stored,
      balanceCents: stored.balanceCents + 1000,
    });

    const report = service.reconcile();
    expect(report.status).toBe('drift_detected');
    expect(report.discrepancies).toHaveLength(1);
    expect(report.discrepancies[0]).toEqual({
      accountId: a.id,
      expectedBalanceCents: dollarsToCents(50),
      actualBalanceCents: dollarsToCents(50) + 1000,
      diffCents: 1000,
    });
  });

  it('reports drift on multiple accounts simultaneously when more than one is corrupted', () => {
    const a = accounts.create({
      id: randomBusinessKey('debit'),
      direction: 'debit',
    });
    const b = accounts.create({
      id: randomBusinessKey('credit'),
      direction: 'credit',
    });

    ledger.applyTransaction({
      entries: [
        { accountId: a.id, direction: 'debit', amount: 10 },
        { accountId: b.id, direction: 'credit', amount: 10 },
      ],
    });

    const aStored = accountsRepo.findById(a.id)!;
    const bStored = accountsRepo.findById(b.id)!;
    accountsRepo.update({
      ...aStored,
      balanceCents: aStored.balanceCents + 100,
    });
    accountsRepo.update({
      ...bStored,
      balanceCents: bStored.balanceCents - 50,
    });

    const report = service.reconcile();
    expect(report.status).toBe('drift_detected');
    expect(report.discrepancies).toHaveLength(2);
  });

  it('reports orphan entries (referencing accounts that do not exist) instead of silently skipping them', () => {
    // Inject a transaction directly into the repo with an orphan entry —
    // bypasses `LedgerService.applyTransaction`'s existence check. The
    // orphan must show up in the report; silently dropping it would defeat
    // the whole point of the reconciliation control.
    const a = accounts.create({
      id: randomBusinessKey('debit'),
      direction: 'debit',
    });
    const txId = randomUuid();
    const orphanEntryId = randomUuid();
    const fixedAt = '2026-01-01T00:00:00.000Z';
    transactionsRepo.create({
      id: txId,
      createdAt: fixedAt,
      entries: [
        {
          id: randomUuid(),
          transactionId: txId,
          accountId: a.id,
          direction: 'debit',
          amountCents: 500,
          createdAt: fixedAt,
        },
        {
          id: orphanEntryId,
          transactionId: txId,
          accountId: 'this-account-does-not-exist',
          direction: 'credit',
          amountCents: 500,
          createdAt: fixedAt,
        },
      ],
    });

    const report = service.reconcile();
    expect(report.status).toBe('drift_detected');
    expect(report.orphanEntries).toEqual([
      {
        transactionId: txId,
        entryId: orphanEntryId,
        accountId: 'this-account-does-not-exist',
      },
    ]);
    // The non-orphan entry was still replayed against `a`, but the actual
    // balance wasn't mutated (we bypassed LedgerService) — so per-account
    // drift on `a` is also reported.
    expect(report.discrepancies).toHaveLength(1);
    expect(report.discrepancies[0].accountId).toBe(a.id);
    expect(report.discrepancies[0].diffCents).toBe(-500);
  });

  it('catches a transposition: per-account drift cancels in the global sum, but per-account check still fires', () => {
    // Setup: one debit account and one credit account, both at zero.
    const a = accounts.create({
      id: randomBusinessKey('debit'),
      direction: 'debit',
    });
    const b = accounts.create({
      id: randomBusinessKey('credit'),
      direction: 'credit',
    });

    // Corrupt both by +X. Global sum contribution: (+1)(+X) + (-1)(+X) = 0.
    // Per-account: both have a +X discrepancy.
    const corruption = 7777;
    accountsRepo.update({
      ...accountsRepo.findById(a.id)!,
      balanceCents: corruption,
    });
    accountsRepo.update({
      ...accountsRepo.findById(b.id)!,
      balanceCents: corruption,
    });

    const report = service.reconcile();
    // Global signed sum still matches opening (both were 0 at start).
    expect(report.globalInvariantHolds).toBe(true);
    expect(report.globalSignedSumCents).toBe(
      report.globalOpeningSignedSumCents,
    );
    // But the per-account check catches both. This is why the dual-invariant
    // matters: a transposition that cancels in the global view is still real
    // drift, and the strictly-stronger per-account replay surfaces it.
    expect(report.status).toBe('drift_detected');
    expect(report.discrepancies).toHaveLength(2);
  });

  it('preserves the global signed-sum invariant from opening balances regardless of transaction activity', () => {
    accounts.create({
      id: randomBusinessKey('cash'),
      direction: 'debit',
      balance: 100,
    });
    accounts.create({
      id: randomBusinessKey('liab'),
      direction: 'credit',
      balance: 100,
    });
    // signed sum = (+1)(100) + (-1)(100) = 0
    expect(service.reconcile().globalOpeningSignedSumCents).toBe(0);
  });

  it('honors an injected `now` timestamp', () => {
    const fixed = new Date('2026-05-05T10:00:00.000Z');
    const report = service.reconcile(fixed);
    expect(report.checkedAt).toBe('2026-05-05T10:00:00.000Z');
  });

  it('correctly replays opposite-direction entries (credit on a debit account / debit on a credit account)', () => {
    // The "balanced sequence" tests above all use *same-direction* entries
    // (debit entries on debit accounts, credit on credit). This test
    // exercises the other half of the four-row direction table: paying $40
    // of cash toward a $100 liability via a debit-on-credit-account entry
    // and a credit-on-debit-account entry. Both balances should *decrease*
    // to $60 — and reconciliation must replay both decreases correctly. If
    // it got the direction rule wrong (added instead of subtracted) the
    // expected balances would be $140, every account would show drift, and
    // the `ok` assertion below would fail.
    const cashId = randomBusinessKey('cash');
    const liabId = randomBusinessKey('liab');
    accounts.create({ id: cashId, direction: 'debit', balance: 100 });
    accounts.create({ id: liabId, direction: 'credit', balance: 100 });

    ledger.applyTransaction({
      entries: [
        { accountId: liabId, direction: 'debit', amount: 40 },
        { accountId: cashId, direction: 'credit', amount: 40 },
      ],
    });

    const report = service.reconcile();
    expect(report.status).toBe('ok');
    expect(report.discrepancies).toEqual([]);
    expect(report.orphanEntries).toEqual([]);
    expect(report.globalInvariantHolds).toBe(true);
  });

  it('accumulates multiple entries on the same account during replay', () => {
    // A single transaction with two debit entries on `a` (60 + 40 = 100)
    // balanced by one credit entry on `b` (100). The reconciliation replay
    // loop must apply *both* `a` entries to arrive at the correct expected
    // balance; if it only applied the first, expected would be 60, the
    // stored balance (correctly 100) would disagree, and reconciliation
    // would fire drift. The `ok` assertion is the contract that both
    // entries were replayed.
    const a = accounts.create({
      id: randomBusinessKey('debit'),
      direction: 'debit',
    });
    const b = accounts.create({
      id: randomBusinessKey('credit'),
      direction: 'credit',
    });

    ledger.applyTransaction({
      entries: [
        { accountId: a.id, direction: 'debit', amount: 60 },
        { accountId: a.id, direction: 'debit', amount: 40 },
        { accountId: b.id, direction: 'credit', amount: 100 },
      ],
    });

    const report = service.reconcile();
    expect(report.status).toBe('ok');
    expect(report.discrepancies).toEqual([]);
    expect(report.globalInvariantHolds).toBe(true);
    // Sanity-check the actual stored value: $100 from two cumulative entries.
    expect(accounts.findById(a.id).balanceCents).toBe(10000);
  });
});
