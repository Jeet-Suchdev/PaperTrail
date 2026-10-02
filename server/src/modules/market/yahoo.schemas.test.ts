import { describe, expect, it } from 'vitest';
import { yahooQuoteSchema } from './yahoo.schemas';

// A field subset of the REAL payload Yahoo returned for RELIANCE.NS in
// Checkpoint 1 — no network in tests, just the shape we validated live.
const reliancePayload = {
  symbol: 'RELIANCE.NS',
  regularMarketPrice: 1167.7,
  regularMarketPreviousClose: 1187,
  regularMarketChange: -19.300049,
  regularMarketChangePercent: -1.6259519,
  regularMarketTime: '2026-10-01T09:45:00.000Z',
  currency: 'INR',
  exchange: 'NSI',
  exchangeDataDelayedBy: 15,
};

describe('yahooQuoteSchema', () => {
  it('accepts a real payload shape, normalizes the timestamp, strips unknown fields', () => {
    const parsed = yahooQuoteSchema.parse({
      ...reliancePayload,
      marketCap: 15801867304960,
      bid: 1167.7,
      fiftyTwoWeekRange: { low: 1160.8, high: 1611.8 },
    });
    expect(parsed.regularMarketPrice).toBe(1167.7);
    expect(parsed.regularMarketTime).toBeInstanceOf(Date);
    expect(parsed.regularMarketTime).toEqual(new Date('2026-10-01T09:45:00.000Z'));
    expect(parsed.exchangeDataDelayedBy).toBe(15);
    expect('marketCap' in parsed).toBe(false);
    expect('bid' in parsed).toBe(false);
    expect('fiftyTwoWeekRange' in parsed).toBe(false);
  });

  it('accepts a Date for regularMarketTime (what the library hands us)', () => {
    const parsed = yahooQuoteSchema.parse({
      ...reliancePayload,
      regularMarketTime: new Date('2026-10-01T09:45:00.000Z'),
    });
    expect(parsed.regularMarketTime).toEqual(new Date('2026-10-01T09:45:00.000Z'));
  });

  it('treats the delay as optional', () => {
    const { exchangeDataDelayedBy: _omitted, ...withoutDelay } = reliancePayload;
    expect(yahooQuoteSchema.parse(withoutDelay).exchangeDataDelayedBy).toBeUndefined();
  });

  it('rejects a payload missing any required field', () => {
    const requiredKeys = [
      'symbol',
      'regularMarketPrice',
      'regularMarketPreviousClose',
      'regularMarketChange',
      'regularMarketChangePercent',
      'regularMarketTime',
      'currency',
      'exchange',
    ] as const;
    for (const key of requiredKeys) {
      const { [key]: _omitted, ...rest } = reliancePayload;
      expect(yahooQuoteSchema.safeParse(rest).success, `missing ${key}`).toBe(false);
    }
  });

  it('rejects bad prices: wrong type, NaN, Infinity, zero, negative', () => {
    for (const bad of ['1167.7', Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      const result = yahooQuoteSchema.safeParse({ ...reliancePayload, regularMarketPrice: bad });
      expect(result.success, `price ${String(bad)}`).toBe(false);
    }
  });

  it('rejects a malformed regularMarketTime', () => {
    for (const bad of ['yesterday', 12345, null]) {
      const result = yahooQuoteSchema.safeParse({ ...reliancePayload, regularMarketTime: bad });
      expect(result.success, `time ${String(bad)}`).toBe(false);
    }
  });

  it('rejects a bad delay (negative or fractional)', () => {
    expect(
      yahooQuoteSchema.safeParse({ ...reliancePayload, exchangeDataDelayedBy: -1 }).success,
    ).toBe(false);
    expect(
      yahooQuoteSchema.safeParse({ ...reliancePayload, exchangeDataDelayedBy: 2.5 }).success,
    ).toBe(false);
  });
});
