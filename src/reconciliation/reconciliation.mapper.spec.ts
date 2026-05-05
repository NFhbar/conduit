import { randomBusinessKey, randomUuid } from '../testing/factories';
import { toReconciliationResponse } from './reconciliation.mapper';
import { ReconciliationReport } from './reconciliation.service';

describe('toReconciliationResponse', () => {
  it('converts cents to dollars across the report, discrepancies, and orphan entries pass through unchanged', () => {
    const accountId = randomBusinessKey('acc');
    const transactionId = randomUuid();
    const orphanEntryId = randomUuid();
    const report: ReconciliationReport = {
      status: 'drift_detected',
      accountsChecked: 3,
      transactionsReplayed: 7,
      globalSignedSumCents: 1500,
      globalOpeningSignedSumCents: 1000,
      globalInvariantHolds: false,
      discrepancies: [
        {
          accountId,
          expectedBalanceCents: 5000,
          actualBalanceCents: 6500,
          diffCents: 1500,
        },
      ],
      orphanEntries: [
        {
          transactionId,
          entryId: orphanEntryId,
          accountId: 'no-such-account',
        },
      ],
      checkedAt: '2026-05-05T10:00:00.000Z',
    };

    const response = toReconciliationResponse(report);

    expect(response.status).toBe('drift_detected');
    expect(response.accountsChecked).toBe(3);
    expect(response.transactionsReplayed).toBe(7);
    expect(response.globalSignedSum).toBe(15);
    expect(response.globalOpeningSignedSum).toBe(10);
    expect(response.globalInvariantHolds).toBe(false);
    expect(response.checkedAt).toBe('2026-05-05T10:00:00.000Z');
    expect(response.discrepancies).toEqual([
      {
        accountId,
        expectedBalance: 50,
        actualBalance: 65,
        diff: 15,
      },
    ]);
    expect(response.orphanEntries).toEqual([
      {
        transactionId,
        entryId: orphanEntryId,
        accountId: 'no-such-account',
      },
    ]);
  });

  it('emits empty arrays for a clean report', () => {
    const response = toReconciliationResponse({
      status: 'ok',
      accountsChecked: 0,
      transactionsReplayed: 0,
      globalSignedSumCents: 0,
      globalOpeningSignedSumCents: 0,
      globalInvariantHolds: true,
      discrepancies: [],
      orphanEntries: [],
      checkedAt: '2026-05-05T10:00:00.000Z',
    });
    expect(response.status).toBe('ok');
    expect(response.discrepancies).toEqual([]);
    expect(response.orphanEntries).toEqual([]);
    expect(response.globalInvariantHolds).toBe(true);
  });
});
