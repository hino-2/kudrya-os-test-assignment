import { spawn } from 'node:child_process';

import { REPO_ROOT, TOOLS_SEED_SCRIPT, TSX_CLI } from './harness.constants';
import type { ISeedCliResult } from './harness.interfaces';

export function runSeedCatalogCli(): Promise<ISeedCliResult> {
  return new Promise<ISeedCliResult>((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, TOOLS_SEED_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}
