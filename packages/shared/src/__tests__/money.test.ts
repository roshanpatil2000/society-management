import { describe, expect, it } from 'vitest';

import { assertPaise, formatPaise, parseRupees } from '../money';

describe('money', () => {
  it('formats paise with Indian digit grouping', () => {
    expect(formatPaise(12_345_600)).toBe('₹1,23,456.00');
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatPaise(-5)).toBe('-₹0.05');
  });

  it('parses rupees typed by people into paise without floating point', () => {
    expect(parseRupees('25000')).toBe(2_500_000);
    expect(parseRupees('₹ 25,000.5')).toBe(2_500_050);
    expect(parseRupees('0.07')).toBe(7);
    expect(parseRupees('')).toBeNull();
    for (const bad of ['-1', '1.234', '1e5', 'abc']) expect(parseRupees(bad)).toBeUndefined();
  });

  it('rejects fractional paise', () => {
    expect(() => assertPaise(10.5)).toThrow();
  });
});
