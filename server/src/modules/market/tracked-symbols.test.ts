import { describe, expect, it } from 'vitest';
import { TrackedSymbols } from './tracked-symbols';

describe('TrackedSymbols', () => {
  it('tracks a mappable symbol and exposes its Yahoo form', () => {
    const tracked = new TrackedSymbols();
    expect(tracked.add('RELIANCE', 'NSE')).toBe(true);
    expect(tracked.add('tcs', 'BSE')).toBe(true);
    expect(tracked.list()).toEqual(['RELIANCE.NS', 'TCS.BO']);
    expect(tracked.size).toBe(2);
  });

  it('never tracks symbols that do not map (dots, spaces, junk)', () => {
    const tracked = new TrackedSymbols();
    expect(tracked.add('RELIANCE.NS', 'NSE')).toBe(false); // suffix smuggled in
    expect(tracked.add('RELIANCE ', 'NSE')).toBe(false);
    expect(tracked.add('A.B.C', 'BSE')).toBe(false);
    expect(tracked.add('', 'NSE')).toBe(false);
    expect(tracked.add('TOO-LONG-SYMBOL-THAT-EXCEEDS', 'NSE')).toBe(false);
    expect(tracked.size).toBe(0);
    expect(tracked.list()).toEqual([]);
  });

  it('is idempotent per symbol+exchange and keeps eviction order stable', () => {
    const tracked = new TrackedSymbols(2);
    expect(tracked.add('AAA', 'NSE')).toBe(true);
    expect(tracked.add('BBB', 'NSE')).toBe(true);
    expect(tracked.add('AAA', 'NSE')).toBe(false); // already tracked, not re-added
    expect(tracked.add('CCC', 'NSE')).toBe(true); // evicts AAA (oldest)
    expect(tracked.list()).toEqual(['BBB.NS', 'CCC.NS']);
  });

  it('tracks the same bare symbol on both exchanges separately', () => {
    const tracked = new TrackedSymbols();
    expect(tracked.add('RELIANCE', 'NSE')).toBe(true);
    expect(tracked.add('RELIANCE', 'BSE')).toBe(true);
    expect(tracked.list()).toEqual(['RELIANCE.NS', 'RELIANCE.BO']);
  });

  it('caps the set and expires the oldest instead of growing', () => {
    const tracked = new TrackedSymbols(200);
    for (let i = 0; i < 200; i++) {
      expect(tracked.add(`S${i}`, 'NSE')).toBe(true);
    }
    expect(tracked.size).toBe(200);
    expect(tracked.list()).toHaveLength(200);

    // 201st evicts the oldest (S0), newest is present.
    expect(tracked.add('OVERFLOW', 'NSE')).toBe(true);
    expect(tracked.size).toBe(200);
    const symbols = tracked.list();
    expect(symbols).not.toContain('S0.NS');
    expect(symbols).toContain('OVERFLOW.NS');
    expect(symbols).toContain('S199.NS');
  });
});
