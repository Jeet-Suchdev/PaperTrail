import { describe, expect, it } from 'vitest';
import { InMemoryPriceCache } from './price-cache';
import type { Quote } from './types';

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: 'RELIANCE',
    exchange: 'NSE',
    pricePaise: 116770,
    prevClosePaise: 118700,
    changePaise: -1930,
    changePercent: -1.63,
    asOf: '2026-10-01T09:45:00.000Z',
    marketTime: '2026-10-01T09:45:00.000Z',
    delayMinutes: 15,
    isSimulated: false,
    ...overrides,
  };
}

describe('InMemoryPriceCache', () => {
  it('stores and returns quotes keyed by symbol + exchange', () => {
    const cache = new InMemoryPriceCache();
    const nse = makeQuote({ exchange: 'NSE', pricePaise: 116770 });
    const bse = makeQuote({ exchange: 'BSE', pricePaise: 116800 });
    cache.set(nse);
    cache.set(bse);
    expect(cache.get('RELIANCE', 'NSE')?.pricePaise).toBe(116770);
    expect(cache.get('RELIANCE', 'BSE')?.pricePaise).toBe(116800);
  });

  it('separates different symbols on the same exchange', () => {
    const cache = new InMemoryPriceCache();
    cache.set(makeQuote({ symbol: 'RELIANCE' }));
    expect(cache.get('TCS', 'NSE')).toBeUndefined();
  });

  it('overwrites on set (latest quote wins)', () => {
    const cache = new InMemoryPriceCache();
    cache.set(makeQuote({ pricePaise: 100000 }));
    cache.set(makeQuote({ pricePaise: 101000 }));
    expect(cache.get('RELIANCE', 'NSE')?.pricePaise).toBe(101000);
  });

  it('keeps the full quote (isSimulated flag survives the round trip)', () => {
    const cache = new InMemoryPriceCache();
    cache.set(makeQuote({ isSimulated: true }));
    expect(cache.get('RELIANCE', 'NSE')?.isSimulated).toBe(true);
  });
});
