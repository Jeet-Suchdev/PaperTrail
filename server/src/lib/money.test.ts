import { describe, expect, it } from 'vitest';
import { formatInr, numberToPaise, paiseToNumber, rupeesToPaise } from './money';

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

describe('rupeesToPaise', () => {
  it('converts rupee floats, absorbing float noise', () => {
    expect(rupeesToPaise(1234.56)).toBe(123456); // 1234.56 × 100 = 123456.00000000001
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30); // 0.30000000000000004 × 100 = 30.000000000000004
    expect(rupeesToPaise(1167.7)).toBe(116770);
    expect(rupeesToPaise(2079.3)).toBe(207930);
    expect(rupeesToPaise(0)).toBe(0);
    expect(rupeesToPaise(0.01)).toBe(1);
  });

  it('rejects NaN and infinities', () => {
    expect(() => rupeesToPaise(Number.NaN)).toThrow(/finite/);
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => rupeesToPaise(Number.NEGATIVE_INFINITY)).toThrow(/finite/);
  });

  it('rejects negative amounts (change is derived from two positive prices)', () => {
    expect(() => rupeesToPaise(-1)).toThrow(/negative/);
    expect(() => rupeesToPaise(-0.001)).toThrow(/negative/);
  });

  it('rejects values that would not survive as safe integers', () => {
    expect(() => rupeesToPaise(1e16)).toThrow(/safe integer/);
  });
});
