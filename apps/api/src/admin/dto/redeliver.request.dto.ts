import { IsOptional, IsString, MaxLength } from 'class-validator';

import { REDELIVER_REASON_MAX_LENGTH } from '../admin.constants';

export class RedeliverRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(REDELIVER_REASON_MAX_LENGTH)
  reason?: string;
}
