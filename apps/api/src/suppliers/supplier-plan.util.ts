import { ATTEMPT_STATE, DELIVERY_OUTCOME } from '../delivery/delivery.constants';
import type { IDeliveryAttemptRow, ISupplierPlanChoice } from '../delivery/delivery.interfaces';
import type { DeliveryOutcome } from '../delivery/delivery.type';
import { FALLBACK_CHAIN, SUPPLIER_ERROR_KIND, SUPPLIER_OUTCOME } from './suppliers.constants';
import type { SupplierCode, SupplierOutcomeKind } from './suppliers.type';

// повтор к тому же поставщику допустим только при http_5xx — прочие исходы (4xx, connection_refused,
// out_of_stock) не гарантируют, что повтор к тому же поставщику что-либо изменит, поэтому сразу
// переходим к следующему в цепочке (см. FALLBACK_CHAIN)
export function isRetriableSameSupplier(attempt: IDeliveryAttemptRow): boolean {
  return attempt.state === ATTEMPT_STATE.FAILED && attempt.error_kind === SUPPLIER_ERROR_KIND.HTTP_5XX;
}

export function isOutOfStockOutcome(attempt: IDeliveryAttemptRow): boolean {
  return attempt.error_kind === SUPPLIER_ERROR_KIND.OUT_OF_STOCK;
}

function lastAttemptFor(attempts: IDeliveryAttemptRow[], supplierCode: SupplierCode): IDeliveryAttemptRow | null {
  const attemptsForSupplier = attempts.filter((attempt) => attempt.supplier_code === supplierCode);

  return attemptsForSupplier[attemptsForSupplier.length - 1] ?? null;
}

// выбирает следующий шаг фолбэка A→B: первый ещё не пробованный поставщик, либо (если бюджет
// повторов не исчерпан) повтор того же поставщика после http_5xx; null означает, что цепочка исчерпана
export function pickSupplier(attempts: IDeliveryAttemptRow[], maxAttemptsPerSupplier: number): ISupplierPlanChoice | null {
  for (const supplierCode of FALLBACK_CHAIN) {
    const lastAttempt = lastAttemptFor(attempts, supplierCode);

    if (!lastAttempt) {
      return { supplierCode, attemptNo: 1 };
    }

    const attemptsSoFar = attempts.filter((attempt) => attempt.supplier_code === supplierCode).length;

    if (isRetriableSameSupplier(lastAttempt) && attemptsSoFar < maxAttemptsPerSupplier) {
      return { supplierCode, attemptNo: lastAttempt.attempt_no + 1 };
    }
  }

  return null;
}

export function allSuppliersOutOfStock(attempts: IDeliveryAttemptRow[]): boolean {
  return FALLBACK_CHAIN.every((supplierCode) => {
    const lastAttempt = lastAttemptFor(attempts, supplierCode);

    return lastAttempt !== null && isOutOfStockOutcome(lastAttempt);
  });
}

export function resolveExhaustedOutcome(attempts: IDeliveryAttemptRow[]): DeliveryOutcome | null {
  return allSuppliersOutOfStock(attempts) ? DELIVERY_OUTCOME.OUT_OF_STOCK : null;
}

export function buildSupplierFailureReason(attempts: IDeliveryAttemptRow[]): string {
  return FALLBACK_CHAIN.map((supplierCode) => {
    const lastAttempt = lastAttemptFor(attempts, supplierCode);

    return `${supplierCode}=${lastAttempt?.error_kind ?? 'no_attempt'}`;
  }).join(', ');
}

export function isDefinitiveOutcome(kind: SupplierOutcomeKind): boolean {
  return kind !== SUPPLIER_OUTCOME.UNKNOWN;
}
