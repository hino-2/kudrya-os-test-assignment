import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { RESTOCK_COUNT_MAX, RESTOCK_COUNT_MIN } from '../admin.constants';

export class RestockRequestDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  codes?: string[];

  @IsOptional()
  @IsInt()
  @Min(RESTOCK_COUNT_MIN)
  @Max(RESTOCK_COUNT_MAX)
  count?: number;
}
