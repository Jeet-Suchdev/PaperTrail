import { describe, expect, it } from 'vitest';
import { changePercentFromPaise } from './change-percent';

describe('changePercentFromPaise', () => {
  it('produces 2-decimal percent from integer paise values', () => {
    expect(changePercentFromPaise(0, 116770)).toBe(0);
    expect(changePercentFromPaise(100, 4000)).toBe(2.5);
    expect(changePercentFromPaise(-467, 116770)).toBe(-0.4);
    // Same numbers Yahoo returned in Checkpoint 1: change -19.300049 on a
    // 1187 previous close. Yahoo's float percent was -1.6259519; from paise
    // we get the same 2-decimal answer a different (integer) way:
    expect(changePercentFromPaise(-1930, 118700)).toBe(-1.63);
  });

  it('rounds to exactly 2 decimals', () => {
    expect(changePercentFromPaise(1, 3)).toBe(33.33); // 33.333... -> 33.33
    expect(changePercentFromPaise(2, 3)).toBe(66.67); // 66.666... -> 66.67
  });

  it('returns 0 when previous close is 0 instead of dividing by zero', () => {
    expect(changePercentFromPaise(500, 0)).toBe(0);
    expect(changePercentFromPaise(0, 0)).toBe(0);
  });
});
