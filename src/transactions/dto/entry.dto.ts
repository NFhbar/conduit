import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { Direction } from '../../domain/direction';

export class EntryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  id?: string;

  @IsString()
  @IsNotEmpty()
  account_id!: string;

  @IsIn(['debit', 'credit'])
  direction!: Direction;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}
