import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { ACCOUNTS_REPOSITORY } from './accounts.repository';
import { InMemoryAccountsRepository } from './accounts.repository.in-memory';
import { AccountsService } from './accounts.service';

@Module({
  controllers: [AccountsController],
  providers: [
    AccountsService,
    { provide: ACCOUNTS_REPOSITORY, useClass: InMemoryAccountsRepository },
  ],
  exports: [AccountsService, ACCOUNTS_REPOSITORY],
})
export class AccountsModule {}
