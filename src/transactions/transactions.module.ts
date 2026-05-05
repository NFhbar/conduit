import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AccountEntriesController } from './account-entries.controller';
import { LedgerService } from './ledger.service';
import { TransactionsController } from './transactions.controller';
import { TRANSACTIONS_REPOSITORY } from './transactions.repository';
import { InMemoryTransactionsRepository } from './transactions.repository.in-memory';

@Module({
  imports: [AccountsModule],
  controllers: [TransactionsController, AccountEntriesController],
  providers: [
    LedgerService,
    {
      provide: TRANSACTIONS_REPOSITORY,
      useClass: InMemoryTransactionsRepository,
    },
  ],
  exports: [LedgerService, TRANSACTIONS_REPOSITORY],
})
export class TransactionsModule {}
