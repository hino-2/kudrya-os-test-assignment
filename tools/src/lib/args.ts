import {
  ARG_PREFIX,
  INVALID_INT_ARG_MESSAGE,
  MISSING_ARG_MESSAGE,
  MISSING_ARG_VALUE_MESSAGE,
} from './lib.constants';
import type { IParsedArgs } from './lib.interfaces';
import type { ArgValue } from './lib.type';

// Собственный минимальный парсер argv вместо npm-зависимости (см. бюджет зависимостей §13):
// CLI tools/* принимают не больше десятка простых флагов вида `--name value` / `--name=value` /
// булев `--name`, чего с запасом хватает без стороннего пакета.
export function parseArgs(argv: string[]): IParsedArgs {
  const result: IParsedArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === undefined || !token.startsWith(ARG_PREFIX)) {
      continue;
    }

    const name = token.slice(ARG_PREFIX.length);
    const eqIndex = name.indexOf('=');

    if (eqIndex !== -1) {
      result[name.slice(0, eqIndex)] = name.slice(eqIndex + 1);
      continue;
    }

    const next = argv[i + 1];

    if (next !== undefined && !next.startsWith(ARG_PREFIX)) {
      result[name] = next;
      i += 1;
      continue;
    }

    result[name] = true;
  }

  return result;
}

// parseArgs кладёт true во флаг без значения, поэтому `--count` без числа давал
// Number(true) === 1, проходил Number.isSafeInteger и молча подменял требуемое значение
// (а `--sku` без значения так же молча уходил в fallback). Значимый флаг без значения —
// ошибка вызова, а не значение по умолчанию.
function requireArgValue(name: string, value: ArgValue): string {
  if (typeof value !== 'string') {
    throw new Error(`${MISSING_ARG_VALUE_MESSAGE}: ${ARG_PREFIX}${name}`);
  }

  return value;
}

export function stringArg(args: IParsedArgs, name: string, fallback?: string): string | undefined {
  const value = args[name];

  return value === undefined ? fallback : requireArgValue(name, value);
}

export function requireStringArg(args: IParsedArgs, name: string): string {
  const value = stringArg(args, name);

  if (value === undefined) {
    throw new Error(`${MISSING_ARG_MESSAGE}: ${ARG_PREFIX}${name}`);
  }

  return value;
}

export function intArg(args: IParsedArgs, name: string, fallback: number): number {
  const value = args[name];

  if (value === undefined) {
    return fallback;
  }

  const raw = requireArgValue(name, value);
  const parsed = raw.trim().length === 0 ? Number.NaN : Number(raw);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${INVALID_INT_ARG_MESSAGE}: ${ARG_PREFIX}${name}="${String(value)}"`);
  }

  return parsed;
}

export function boolFlag(args: IParsedArgs, name: string): boolean {
  return args[name] === true || args[name] === 'true';
}

export function hasArg(args: IParsedArgs, name: string): boolean {
  return args[name] !== undefined;
}
