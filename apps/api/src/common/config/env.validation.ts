import * as os from 'node:os';

import { CONFIG_ERROR_HEADER, ENV_CROSS_RULES, ENV_SPEC } from './config.constants';
import type { IEnvIssue, IEnvVarSpec } from './config.interfaces';
import type { AppEnv, EnvRaw } from './config.type';

const BOOL_TRUE_VALUES = ['true', '1', 'yes'];
const BOOL_FALSE_VALUES = ['false', '0', 'no'];
const INT_PATTERN = /^-?\d+$/;

export function defaultWorkerId(): string {
  return `${os.hostname()}:${process.pid}`;
}

function isAbsent(value: unknown, spec: IEnvVarSpec): boolean {
  if (value === undefined) {
    return true;
  }

  return value === '' && spec.allowEmpty !== true;
}

function coerceInt(name: string, value: string, spec: IEnvVarSpec, issues: IEnvIssue[]): number | undefined {
  const min = spec.min ?? -Infinity;
  const max = spec.max ?? Infinity;

  if (!INT_PATTERN.test(value)) {
    issues.push({ name, reason: `ожидалось целое число в диапазоне ${min}..${max}, получено "${value}"` });

    return undefined;
  }

  const parsed = Number(value);

  if (parsed < min || parsed > max) {
    issues.push({ name, reason: `ожидалось целое число в диапазоне ${min}..${max}, получено "${value}"` });

    return undefined;
  }

  return parsed;
}

function coerceBool(name: string, value: string, issues: IEnvIssue[]): boolean | undefined {
  const normalized = value.toLowerCase();

  if (BOOL_TRUE_VALUES.includes(normalized)) {
    return true;
  }

  if (BOOL_FALSE_VALUES.includes(normalized)) {
    return false;
  }

  issues.push({ name, reason: `ожидалось булево значение (true|false), получено "${value}"` });

  return undefined;
}

function coerceEnum(name: string, value: string, spec: IEnvVarSpec, issues: IEnvIssue[]): string | undefined {
  const values = spec.values ?? [];

  if (values.includes(value)) {
    return value;
  }

  issues.push({ name, reason: `ожидалось одно из: ${values.join('|')}, получено "${value}"` });

  return undefined;
}

function coerceUrl(name: string, value: string, spec: IEnvVarSpec, issues: IEnvIssue[]): string | undefined {
  const protocols = spec.protocols ?? [];

  try {
    const parsed = new URL(value);

    if (protocols.length > 0 && !protocols.includes(parsed.protocol)) {
      issues.push({ name, reason: `ожидался URL со схемой ${protocols.join('/')}, получено "${value}"` });

      return undefined;
    }

    return value;
  } catch {
    issues.push({ name, reason: `ожидался URL со схемой ${protocols.join('/')}, получено "${value}"` });

    return undefined;
  }
}

function coerceValue(spec: IEnvVarSpec, rawValue: string, issues: IEnvIssue[]): unknown {
  switch (spec.kind) {
    case 'int':
      return coerceInt(spec.name, rawValue, spec, issues);
    case 'bool':
      return coerceBool(spec.name, rawValue, issues);
    case 'enum':
      return coerceEnum(spec.name, rawValue, spec, issues);
    case 'url':
      return coerceUrl(spec.name, rawValue, spec, issues);
    case 'string':
      return rawValue;
  }
}

function resolveVar(raw: EnvRaw, spec: IEnvVarSpec, issues: IEnvIssue[]): unknown {
  const rawValue = raw[spec.name];
  const absent = isAbsent(rawValue, spec);

  if (absent) {
    if (spec.required === true) {
      issues.push({ name: spec.name, reason: 'обязательная переменная не задана' });

      return undefined;
    }

    return spec.default;
  }

  return coerceValue(spec, String(rawValue), issues);
}

function runCrossRules(env: AppEnv, issues: readonly IEnvIssue[]): IEnvIssue[] {
  const failedFields = new Set(issues.map((issue) => issue.name));
  const crossIssues: IEnvIssue[] = [];

  for (const rule of ENV_CROSS_RULES) {
    if (rule.fields.some((field) => failedFields.has(field))) {
      continue;
    }

    const issue = rule.check(env);

    if (issue !== null) {
      crossIssues.push(issue);
    }
  }

  return crossIssues;
}

export function validateEnv(raw: EnvRaw): AppEnv {
  const issues: IEnvIssue[] = [];
  const result: Record<string, unknown> = {};

  for (const spec of ENV_SPEC) {
    result[spec.name] = resolveVar(raw, spec, issues);
  }

  if (result.WORKER_ID === undefined || result.WORKER_ID === '') {
    result.WORKER_ID = defaultWorkerId();
  }

  issues.push(...runCrossRules(result as unknown as AppEnv, issues));

  if (issues.length > 0) {
    const message = `${CONFIG_ERROR_HEADER} (${issues.length}):\n${issues
      .map((issue) => `  - ${issue.name}: ${issue.reason}`)
      .join('\n')}`;

    throw new Error(message);
  }

  return result as unknown as AppEnv;
}
