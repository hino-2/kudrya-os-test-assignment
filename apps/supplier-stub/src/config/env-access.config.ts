export function readEnv(): NodeJS.ProcessEnv {
  return process.env;
}

export function applyEnvOverrides(overrides: Readonly<Record<string, string>>): void {
  Object.assign(process.env, overrides);
}
