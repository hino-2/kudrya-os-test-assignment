import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { REQUEST_ID_MAX_LENGTH } from '../issue.constants';

export class IssueRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(REQUEST_ID_MAX_LENGTH)
  request_id!: string;

  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsString()
  @IsNotEmpty()
  order_id!: string;
}
