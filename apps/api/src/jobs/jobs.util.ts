import { JOB_DEDUPE_ORDER_PREFIX } from './jobs.constants';

export function buildDeliverOrderDedupeKey(extId: string): string {
  return `${JOB_DEDUPE_ORDER_PREFIX}${extId}`;
}
