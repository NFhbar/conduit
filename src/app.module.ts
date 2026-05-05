import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { TransactionsModule } from './transactions/transactions.module';

@Module({
  imports: [
    IdempotencyModule,
    AccountsModule,
    TransactionsModule,
    ReconciliationModule,
  ],
})
export class AppModule {}
