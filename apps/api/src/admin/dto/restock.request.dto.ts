import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import {
  RESTOCK_CODE_MAX_LENGTH,
  RESTOCK_CODE_REGEX,
  RESTOCK_COUNT_MAX,
  RESTOCK_COUNT_MIN,
} from '../admin.constants';

export class RestockRequestDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(RESTOCK_COUNT_MAX)
  @IsString({ each: true })
  @Length(1, RESTOCK_CODE_MAX_LENGTH, { each: true })
  @Matches(RESTOCK_CODE_REGEX, { each: true })
  codes?: string[];

  @IsOptional()
  @IsInt()
  @Min(RESTOCK_COUNT_MIN)
  @Max(RESTOCK_COUNT_MAX)
  count?: number;
}
