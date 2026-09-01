import { Injectable, ValidationPipe } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';

import { LENIENT_VALIDATION_PIPE_OPTIONS, VALIDATION_PIPE_OPTIONS } from './http.constants';
import { isLenientDto } from './http.util';

@Injectable()
export class AppValidationPipe implements PipeTransform {
  private readonly strictPipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

  private readonly lenientPipe = new ValidationPipe(LENIENT_VALIDATION_PIPE_OPTIONS);

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const pipe = isLenientDto(metadata.metatype) ? this.lenientPipe : this.strictPipe;

    return pipe.transform(value, metadata);
  }
}
