import { describe, expect, it } from 'vitest';
import { formatInr, numberToPaise, paiseToNumber } from './money';

describe('money', () => {
  it('round-trips paise through JSON-safe numbers', () => {
    expect(paiseToNumber(100000000n)).toBe(100000000);
    expect(numberToPaise(100000000)).toBe(100000000n);
    expect(numberToPaise(paiseToNumber(9999n))).toBe(9999n);
  });

  it('rejects BigInt values that are not safe integers', () => {
    expect(() => paiseToNumber(9007199254740992n)).toThrow(/safe integer/);
  });

  it('rejects fractional and oversized numbers', () => {
    expect(() => numberToPaise(10.5)).toThrow(/not an integer/);
    expect(() => numberToPaise(9007199254740992)).toThrow(/MAX_SAFE_INTEGER/);
  });

  it('formats paise as Indian-grouped rupees', () => {
    expect(formatInr(100000000)).toBe('₹10,00,000.00');
    expect(formatInr(12345)).toBe('₹123.45');
    expect(() => formatInr(10.5)).toThrow(/not an integer/);
  });
});
