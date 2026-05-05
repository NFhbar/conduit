import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  PageResponse,
  PaginationQueryDto,
  resolvePageQuery,
  toPageResponse,
} from '../common/pagination';
import { CreateAccountDto } from './dto/create-account.dto';
import { AccountResponse, toAccountResponse } from './accounts.mapper';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  create(@Body() dto: CreateAccountDto): AccountResponse {
    const account = this.accounts.create({
      id: dto.id,
      name: dto.name,
      direction: dto.direction,
      balance: dto.balance,
    });
    return toAccountResponse(account);
  }

  @Get()
  list(@Query() query: PaginationQueryDto): PageResponse<AccountResponse> {
    return toPageResponse(
      this.accounts.list(resolvePageQuery(query)),
      toAccountResponse,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string): AccountResponse {
    return toAccountResponse(this.accounts.findById(id));
  }
}
