import { describe, expect, it } from 'vitest';

import { assertPaise, formatPaise } from '../money';

describe('money', () => {
  it('formats paise with Indian digit grouping', () => {
    expect(formatPaise(12_345_600)).toBe('₹1,23,456.00');
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatPaise(-5)).toBe('-₹0.05');
  });

  it('rejects fractional paise', () => {
    expect(() => assertPaise(10.5)).toThrow();
  });
});
