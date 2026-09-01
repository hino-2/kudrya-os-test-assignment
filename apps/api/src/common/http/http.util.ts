import { LENIENT_VALIDATION } from './http.constants';

export function isLenientDto(metatype: unknown): boolean {
  return typeof metatype === 'function' && LENIENT_VALIDATION in metatype;
}
