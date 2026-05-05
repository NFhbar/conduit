import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  PageResponse,
  PaginationQueryDto,
  resolvePageQuery,
  toPageResponse,
} from '../common/pagination';
import { LedgerService } from './ledger.service';
import { EntryResponse, toEntryResponse } from './transactions.mapper';

/**
 * Lives under `/accounts/:id/entries` despite belonging to the transactions
 * module — that's where account history reads from. Putting it on
 * `AccountsController` would force `AccountsModule` to import
 * `TransactionsModule`, creating a cycle since `TransactionsModule` already
 * imports `AccountsModule` for the repository token.
 *
 * One consequence: routes under `/accounts/*` are now split across two
 * modules. Nest's dispatcher handles routing fine, but a reader looking
 * for "all `/accounts/*` routes" has to know to look in both. Acceptable
 * for one cross-module endpoint. *If* a second one shows up (say
 * `GET /accounts/:id/transactions` or similar), the right answer is a
 * dedicated `AccountsHistoryModule` (or similar) that owns the
 * cross-cutting concern explicitly — not piling more controllers into
 * `TransactionsModule`.
 */
@Controller('accounts')
export class AccountEntriesController {
  constructor(private readonly ledger: LedgerService) {}

  @Get(':id/entries')
  listEntries(
    @Param('id') accountId: string,
    @Query() query: PaginationQueryDto,
  ): PageResponse<EntryResponse> {
    return toPageResponse(
      this.ledger.findEntriesByAccountId(accountId, resolvePageQuery(query)),
      toEntryResponse,
    );
  }
}
