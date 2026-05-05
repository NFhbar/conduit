import { Body, Controller, Post } from '@nestjs/common';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { LedgerService } from './ledger.service';
import {
  TransactionResponse,
  toTransactionResponse,
} from './transactions.mapper';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly ledger: LedgerService) {}

  @Post()
  create(@Body() dto: CreateTransactionDto): TransactionResponse {
    const transaction = this.ledger.applyTransaction({
      id: dto.id,
      name: dto.name,
      entries: dto.entries.map((entry) => ({
        id: entry.id,
        accountId: entry.account_id,
        direction: entry.direction,
        amount: entry.amount,
      })),
    });
    return toTransactionResponse(transaction);
  }
}
