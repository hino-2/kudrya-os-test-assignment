import { IsIn, IsInt, IsISO8601, IsString, Length, Matches, Min } from 'class-validator';

import { LENIENT_VALIDATION } from '../../common/http/http.constants';
import type { CurrencyCode } from '../../common/money/money.type';
import { EXT_ID_REGEX } from '../../orders/orders.constants';
import type { PaymentStatus } from '../payments.type';
import {
  EVENT_ID_MAX_LENGTH,
  EVENT_ID_MIN_LENGTH,
  ISO_8601_WITH_OFFSET_REGEX,
  WEBHOOK_AMOUNT_MIN,
  WEBHOOK_CURRENCY_VALUES,
  WEBHOOK_STATUS_VALUES,
} from '../payments.constants';

export class PaymentWebhookRequestDto {
  static readonly [LENIENT_VALIDATION] = true;

  @IsString()
  @Length(EVENT_ID_MIN_LENGTH, EVENT_ID_MAX_LENGTH)
  event_id!: string;

  @IsString()
  @Matches(EXT_ID_REGEX)
  order_id!: string;

  @IsIn(WEBHOOK_STATUS_VALUES)
  status!: PaymentStatus;

  @IsInt()
  @Min(WEBHOOK_AMOUNT_MIN)
  amount!: number;

  @IsIn(WEBHOOK_CURRENCY_VALUES)
  currency!: CurrencyCode;

  // strict + strictSeparator + явное смещение: дефолтный IsISO8601 принимает basic-формат
  // ("20250101T120000Z"), который new Date() не парсит, календарно невозможные даты
  // ("2025-02-30" тихо уезжает в 2025-03-02) и время без смещения, которое трактуется
  // в таймзоне процесса и ломает порядок событий по-разному в разных окружениях
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(ISO_8601_WITH_OFFSET_REGEX)
  created_at!: string;
}
