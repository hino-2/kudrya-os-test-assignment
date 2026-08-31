import { describe, expect, it } from 'vitest';

import {
  CLIENT_EXT_ID_REGEX,
  EXT_ID_REGEX,
  MINTED_EXT_ID_REGEX,
} from '../../src/orders/orders.constants';

const MINTED_SAMPLES = ['ord_00100', 'ord_0', 'ord_99999', 'ord_1234567890'];

const CLIENT_SAMPLES = ['ord_idem_1', 'ord_a', 'ord_cart-42', 'ord_00100a', 'ord_a00100'];

const MALFORMED_SAMPLES = ['ord_', 'order_1', 'ord 1', 'ORD_1', 'ord_идем', ''];

describe('ext id namespaces', () => {
  it.each(MINTED_SAMPLES)('treats %s as a minted id', (value) => {
    expect(MINTED_EXT_ID_REGEX.test(value)).toBe(true);
  });

  it.each(MINTED_SAMPLES)('rejects the minted id %s as a client-supplied id', (value) => {
    expect(CLIENT_EXT_ID_REGEX.test(value)).toBe(false);
  });

  it.each(CLIENT_SAMPLES)('accepts %s as a client-supplied id', (value) => {
    expect(CLIENT_EXT_ID_REGEX.test(value)).toBe(true);
    expect(MINTED_EXT_ID_REGEX.test(value)).toBe(false);
  });

  it.each(MALFORMED_SAMPLES)('rejects the malformed id %s everywhere', (value) => {
    expect(CLIENT_EXT_ID_REGEX.test(value)).toBe(false);
    expect(EXT_ID_REGEX.test(value)).toBe(false);
  });

  it('keeps the two namespaces disjoint and both inside the read format', () => {
    const accepted = [...MINTED_SAMPLES, ...CLIENT_SAMPLES];

    for (const value of accepted) {
      expect(EXT_ID_REGEX.test(value)).toBe(true);
      expect(MINTED_EXT_ID_REGEX.test(value) && CLIENT_EXT_ID_REGEX.test(value)).toBe(false);
    }
  });

  it('bounds a client-supplied id by the same length as the read format', () => {
    const tooLong = `ord_${'a'.repeat(41)}`;

    expect(CLIENT_EXT_ID_REGEX.test(tooLong)).toBe(false);
    expect(EXT_ID_REGEX.test(tooLong)).toBe(false);
  });
});
