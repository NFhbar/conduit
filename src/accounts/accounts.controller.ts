import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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

  @Get(':id')
  findOne(@Param('id') id: string): AccountResponse {
    return toAccountResponse(this.accounts.findById(id));
  }
}
