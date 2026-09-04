import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

import { AppConfigService } from '../common/config/app-config.service';
import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { ADMIN_TOKEN_HEADER } from './admin.constants';

@Injectable()
export class AdminTokenGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.admin.enabled) {
      throw new DomainError(ERROR_CODE.ADMIN_DISABLED);
    }

    if (this.config.admin.guardDisabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[ADMIN_TOKEN_HEADER];
    const presented = typeof header === 'string' ? header : null;

    if (presented === null || !this.tokenMatches(presented)) {
      throw new DomainError(ERROR_CODE.UNAUTHORIZED);
    }

    return true;
  }

  // Сравнение постоянного времени: длины должны совпасть до вызова timingSafeEqual,
  // иначе сама проверка длины утечёт через исключение.
  private tokenMatches(presented: string): boolean {
    const expected = Buffer.from(this.config.admin.token);
    const actual = Buffer.from(presented);

    if (expected.length !== actual.length) {
      return false;
    }

    return timingSafeEqual(expected, actual);
  }
}
