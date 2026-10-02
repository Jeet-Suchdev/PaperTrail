import { describe, expect, it } from 'vitest';
import { createSeededRng, SimulatedProvider } from './simulated-provider';

const FIXED_NOW = new Date('2026-10-02T10:00:00.000Z');
const FIXED_ISO = FIXED_NOW.toISOString();

function makeProvider(options: ConstructorParameters<typeof SimulatedProvider>[0] = {}) {
  return new SimulatedProvider({ rng: createSeededRng(42), now: () => FIXED_NOW, ...options });
}

describe('createSeededRng', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a1 = createSeededRng(42);
    const a2 = createSeededRng(42);
    const b = createSeededRng(7);
    const seq1 = Array.from({ length: 5 }, () => a1());
    const seq2 = Array.from({ length: 5 }, () => a2());
    const seq3 = Array.from({ length: 5 }, () => b());
    expect(seq1).toEqual(seq2);
    expect(seq1).not.toEqual(seq3);
    for (const value of seq1) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('SimulatedProvider.getQuotes', () => {
  it('returns a table-based quote in integer paise with asOf from the clock', async () => {
    const [quote] = await makeProvider().getQuotes(['RELIANCE.NS']);
    expect(quote).toMatchObject({
      symbol: 'RELIANCE',
      exchange: 'NSE',
      pricePaise: 116770,
      prevClosePaise: 116770,
      changePaise: 0,
      changePercent: 0,
      asOf: FIXED_ISO,
      marketTime: FIXED_ISO,
      isSimulated: true,
    });
    expect(quote!.delayMinutes).toBeUndefined();
    expect(Number.isInteger(quote!.pricePaise)).toBe(true);
  });

  it('leaves unknown symbols out of the result (not found, no throw)', async () => {
    const provider = makeProvider();
    expect(await provider.getQuotes(['ZZZQQQ.NS', 'GARBAGE', 'AAPL'])).toEqual([]);
    const quotes = await provider.getQuotes(['RELIANCE.NS', 'ZZZQQQ.NS', 'TCS.BO']);
    expect(quotes).toHaveLength(2);
    expect(quotes.map((q) => q.symbol)).toEqual(['RELIANCE', 'TCS']);
  });

  it('walks deterministically for a given seed, starting at the base price', async () => {
    async function walk(provider: SimulatedProvider): Promise<number[]> {
      const prices: number[] = [];
      for (let i = 0; i < 5; i++) {
        const [quote] = await provider.getQuotes(['RELIANCE.NS']);
        prices.push(quote!.pricePaise);
      }
      return prices;
    }
    const seed42a = await walk(makeProvider());
    const seed42b = await walk(makeProvider());
    const seed7 = await walk(makeProvider({ rng: createSeededRng(7) }));
    expect(seed42a).toEqual(seed42b); // same seed -> identical sequence
    expect(seed42a).not.toEqual(seed7); // different seed -> different sequence
    expect(seed42a[0]).toBe(116770); // first sighting returns the untouched seed
    expect(seed42a.some((p) => p !== 116770)).toBe(true); // the walk actually moves
    expect(seed42a.every((p) => Number.isInteger(p) && p > 0)).toBe(true);
  });

  it('can produce a negative change with integer math only', async () => {
    const provider = makeProvider({ rng: () => 0 }); // constant -0.4% drift
    await provider.getQuotes(['RELIANCE.NS']); // seed only
    const [quote] = await provider.getQuotes(['RELIANCE.NS']);
    expect(quote!.pricePaise).toBeLessThan(quote!.prevClosePaise);
    expect(quote!.changePaise).toBe(quote!.pricePaise - quote!.prevClosePaise);
    expect(quote!.changePaise).toBeLessThan(0);
    expect(quote!.changePercent).toBeLessThan(0);
    expect(Number.isInteger(quote!.changePaise)).toBe(true);
  });

  it('seeds from getLastKnownPricePaise when it returns a valid price', async () => {
    const provider = makeProvider({
      getLastKnownPricePaise: (symbol) => (symbol === 'RELIANCE' ? 555555 : null),
    });
    const [rel] = await provider.getQuotes(['RELIANCE.NS']);
    expect(rel!.pricePaise).toBe(555555); // cache wins over the table
    const [tcs] = await provider.getQuotes(['TCS.BO']);
    expect(tcs!.pricePaise).toBe(207930); // null -> table fallback (2079.30)
  });

  it('falls back to the table when the injected price is unusable', async () => {
    for (const bad of [0, -1, Number.NaN]) {
      const provider = makeProvider({ getLastKnownPricePaise: () => bad });
      const [quote] = await provider.getQuotes(['RELIANCE.NS']);
      expect(quote!.pricePaise, `injected ${String(bad)}`).toBe(116770);
    }
  });

  it('serves cache-only symbols but still rejects unparseable ones', async () => {
    const provider = makeProvider({ getLastKnownPricePaise: () => 999 });
    const [quote] = await provider.getQuotes(['ZZZQQQ.NS']);
    expect(quote!.pricePaise).toBe(999); // unknown to the table, known to the cache
    expect(await provider.getQuotes(['GARBAGE'])).toEqual([]); // no valid suffix -> not found
  });
});

describe('SimulatedProvider.searchInstruments', () => {
  it('matches the table by symbol or name', async () => {
    const provider = makeProvider();
    const bySymbol = await provider.searchInstruments('reliance');
    expect(bySymbol).toContainEqual({
      symbol: 'RELIANCE',
      exchange: 'NSE',
      yahooSymbol: 'RELIANCE.NS',
      name: 'Reliance Industries Limited',
    });
    const byName = await provider.searchInstruments('mahindra');
    expect(byName[0]).toMatchObject({ symbol: 'M&M', yahooSymbol: 'M&M.NS' });
  });

  it('returns nothing for garbage or empty queries', async () => {
    const provider = makeProvider();
    expect(await provider.searchInstruments('zzzzqqq')).toEqual([]);
    expect(await provider.searchInstruments('   ')).toEqual([]);
  });
});
