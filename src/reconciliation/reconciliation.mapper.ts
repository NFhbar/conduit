import { centsToDollars } from '../domain/money';
import {
  AccountDiscrepancy,
  OrphanEntry,
  ReconciliationReport,
} from './reconciliation.service';

export interface AccountDiscrepancyResponse {
  accountId: string;
  expectedBalance: number;
  actualBalance: number;
  /**
   * `actualBalance - expectedBalance`, in dollars. Positive means the stored
   * balance is higher than the entry history justifies; negative means lower.
   */
  diff: number;
}

export interface OrphanEntryResponse {
  transactionId: string;
  entryId: string;
  accountId: string;
}

export interface ReconciliationResponse {
  status: 'ok' | 'drift_detected';
  accountsChecked: number;
  transactionsReplayed: number;
  globalSignedSum: number;
  globalOpeningSignedSum: number;
  globalInvariantHolds: boolean;
  discrepancies: AccountDiscrepancyResponse[];
  orphanEntries: OrphanEntryResponse[];
  checkedAt: string;
}

function toDiscrepancyResponse(
  d: AccountDiscrepancy,
): AccountDiscrepancyResponse {
  return {
    accountId: d.accountId,
    expectedBalance: centsToDollars(d.expectedBalanceCents),
    actualBalance: centsToDollars(d.actualBalanceCents),
    diff: centsToDollars(d.diffCents),
  };
}

function toOrphanEntryResponse(o: OrphanEntry): OrphanEntryResponse {
  return {
    transactionId: o.transactionId,
    entryId: o.entryId,
    accountId: o.accountId,
  };
}

export function toReconciliationResponse(
  report: ReconciliationReport,
): ReconciliationResponse {
  return {
    status: report.status,
    accountsChecked: report.accountsChecked,
    transactionsReplayed: report.transactionsReplayed,
    globalSignedSum: centsToDollars(report.globalSignedSumCents),
    globalOpeningSignedSum: centsToDollars(report.globalOpeningSignedSumCents),
    globalInvariantHolds: report.globalInvariantHolds,
    discrepancies: report.discrepancies.map(toDiscrepancyResponse),
    orphanEntries: report.orphanEntries.map(toOrphanEntryResponse),
    checkedAt: report.checkedAt,
  };
}
