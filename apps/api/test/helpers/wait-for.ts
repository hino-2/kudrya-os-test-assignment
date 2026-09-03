import {
  WAIT_FOR_DEFAULT_STEP_MS,
  WAIT_FOR_DEFAULT_TIMEOUT_MESSAGE,
  WAIT_FOR_DEFAULT_TIMEOUT_MS,
} from './harness.constants';
import type { IWaitForOptions } from './harness.interfaces';

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// поллинг вместо фиксированного sleep: асинхронные побочные эффекты (тик воркера, фоновая
// задача, HTTP-обработчик) не гарантированы к первому опросу — read() перечитывает состояние
// до тех пор, пока predicate не станет истинным или не истечёт timeoutMs
export async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: IWaitForOptions = {},
): Promise<T> {
  const stepMs = options.stepMs ?? WAIT_FOR_DEFAULT_STEP_MS;
  const timeoutMs = options.timeoutMs ?? WAIT_FOR_DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  let last = await read();

  while (!predicate(last) && Date.now() < deadline) {
    await delay(stepMs);
    last = await read();
  }

  if (!predicate(last)) {
    throw new Error(options.message ?? WAIT_FOR_DEFAULT_TIMEOUT_MESSAGE);
  }

  return last;
}

export async function waitForCondition(
  check: () => Promise<boolean> | boolean,
  options: IWaitForOptions = {},
): Promise<void> {
  await waitFor(async () => Boolean(await check()), (value) => value, options);
}
