import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { LedgerService } from './ledger.service';
import { TransactionsController } from './transactions.controller';
import { TRANSACTIONS_REPOSITORY } from './transactions.repository';
import { InMemoryTransactionsRepository } from './transactions.repository.in-memory';

@Module({
  imports: [AccountsModule],
  controllers: [TransactionsController],
  providers: [
    LedgerService,
    {
      provide: TRANSACTIONS_REPOSITORY,
      useClass: InMemoryTransactionsRepository,
    },
  ],
  exports: [LedgerService],
})
export class TransactionsModule {}
