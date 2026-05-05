import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';

/**
 * Reconciliation is the second consumer of `ACCOUNTS_REPOSITORY` and
 * `TRANSACTIONS_REPOSITORY` (after `LedgerService`). The cross-module repo
 * coupling is structural rather than incidental: any future change to the
 * tokens or the sweep API now ripples through both `accounts/`,
 * `transactions/`, and `reconciliation/`. The alternative — exposing
 * `findAll()` on the services — would push a sweep API into the public
 * surface of services that don't otherwise need it. Current shape is the
 * better trade-off; flagged here so it isn't a surprise.
 */
@Module({
  imports: [AccountsModule, TransactionsModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
