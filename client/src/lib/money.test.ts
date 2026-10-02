import { describe, expect, it } from 'vitest';
import { formatInr } from './money';

describe('formatInr', () => {
  it('formats the starting balance with Indian digit grouping', () => {
    expect(formatInr(100000000)).toBe('₹10,00,000.00');
  });

  it('formats zero', () => {
    expect(formatInr(0)).toBe('₹0.00');
  });

  it('formats values that include paise', () => {
    expect(formatInr(12345)).toBe('₹123.45');
    expect(formatInr(99)).toBe('₹0.99');
  });

  it('rejects fractional paise — money is whole paise only', () => {
    expect(() => formatInr(10.5)).toThrow(/not an integer/);
  });
});
