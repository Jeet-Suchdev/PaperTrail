import { beforeEach, describe, expect, it, vi } from 'vitest';

import quoteReliance from './__fixtures__/quote-reliance-ns.json';
import quoteTcs from './__fixtures__/quote-tcs-bo.json';
import searchReliance from './__fixtures__/search-reliance.json';
import { createTimeoutFetch, YahooProvider, type YahooProviderOptions } from './yahoo-provider';

// The library is mocked: tests NEVER touch the network (Checkpoint 3 rule).
// Constructor options are captured so tests can assert how we wire it.
const yahooMock = vi.hoisted(() => ({
  quote: vi.fn(),
  search: vi.fn(),
  constructorOptions: [] as unknown[],
}));

vi.mock('yahoo-finance2', () => ({
  default: class MockYahooFinance {
    quote = yahooMock.quote;
    search = yahooMock.search;
    constructor(options: unknown) {
      yahooMock.constructorOptions.push(options);
    }
  },
}));

const FIXED_NOW = new Date('2026-10-03T08:00:00.000Z');
const FIXED_ISO = FIXED_NOW.toISOString();

function silentLogger() {
  return {
    info: vi.fn((_message: string) => undefined),
    warn: vi.fn((_message: string) => undefined),
  };
}

function makeProvider(options: YahooProviderOptions = {}) {
  const logger = silentLogger();
  const provider = new YahooProvider({ now: () => FIXED_NOW, logger, ...options });
  return { provider, logger };
}

beforeEach(() => {
  yahooMock.quote.mockReset();
  yahooMock.search.mockReset();
  yahooMock.constructorOptions.length = 0;
});

describe('YahooProvider.getQuotes', () => {
  it('converts real fixture quotes to integer paise with asOf from our clock', async () => {
    yahooMock.quote.mockResolvedValue([quoteReliance, quoteTcs]);
    const { provider } = makeProvider();

    const quotes = await provider.getQuotes(['RELIANCE.NS', 'TCS.BO']);
    expect(quotes).toHaveLength(2);

    const rel = quotes.find((q) => q.symbol === 'RELIANCE');
    expect(rel).toMatchObject({
      exchange: 'NSE',
      pricePaise: 116770,
      prevClosePaise: 118700,
      changePaise: -1930,
      changePercent: -1.63, // computed from paise, not the upstream float
      asOf: FIXED_ISO,
      marketTime: '2026-10-01T09:45:00.000Z',
      delayMinutes: 15,
      isSimulated: false,
    });

    const tcs = quotes.find((q) => q.symbol === 'TCS');
    expect(tcs).toMatchObject({
      exchange: 'BSE',
      pricePaise: 207930,
      prevClosePaise: 205000,
      changePaise: 2930,
      changePercent: 1.43,
      asOf: FIXED_ISO,
      marketTime: '2026-10-01T10:20:08.000Z',
      delayMinutes: 15,
      isSimulated: false,
    });
    expect(Number.isInteger(rel!.pricePaise)).toBe(true);
    expect(Number.isInteger(tcs!.pricePaise)).toBe(true);
  });

  it('dedupes and normalises symbols, calling the library once', async () => {
    yahooMock.quote.mockResolvedValue([quoteReliance]);
    const { provider } = makeProvider();

    await provider.getQuotes([' reliance.ns ', 'RELIANCE.NS', 'RELIANCE.NS']);
    expect(yahooMock.quote).toHaveBeenCalledTimes(1);
    expect(yahooMock.quote).toHaveBeenCalledWith(['RELIANCE.NS'], {}, { validateResult: false });
  });

  it('skips the library entirely for empty input', async () => {
    const { provider } = makeProvider();
    expect(await provider.getQuotes([])).toEqual([]);
    expect(await provider.getQuotes(['   '])).toEqual([]);
    expect(yahooMock.quote).not.toHaveBeenCalled();
  });

  it('treats a fully-skipped upstream answer as not-found, not a failure', async () => {
    yahooMock.quote.mockResolvedValue([]);
    const { provider } = makeProvider();
    expect(await provider.getQuotes(['NOPE.NS'])).toEqual([]);
  });

  it('drops a malformed item, keeps the rest, and logs the symbol only', async () => {
    const malformed = { ...quoteTcs, regularMarketPrice: 'not-a-number' };
    yahooMock.quote.mockResolvedValue([quoteReliance, malformed]);
    const { provider, logger } = makeProvider();

    const quotes = await provider.getQuotes(['RELIANCE.NS', 'TCS.BO']);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.symbol).toBe('RELIANCE');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('dropped malformed quote for TCS.BO');
  });

  it('throws (outage-shaped) when EVERY item fails validation', async () => {
    yahooMock.quote.mockResolvedValue([
      { ...quoteTcs, regularMarketPrice: 'oops' },
      { ...quoteTcs, regularMarketPreviousClose: null },
    ]);
    const { provider } = makeProvider();

    await expect(provider.getQuotes(['A.NS', 'B.BO'])).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'MarketValidationError' &&
        error.message.includes('2 quote(s)'),
    );
  });

  it('drops symbols we cannot map to a bare symbol + Indian exchange', async () => {
    yahooMock.quote.mockResolvedValue([{ ...quoteReliance, symbol: 'WEIRD.XX' }]);
    const { provider, logger } = makeProvider();

    await expect(provider.getQuotes(['WEIRD.XX'])).rejects.toMatchObject({
      name: 'MarketValidationError',
    });
    expect(logger.warn).toHaveBeenCalledWith('dropped unmappable quote for WEIRD.XX');
  });

  it('propagates the library validation error name the service classifies on', async () => {
    const libraryError = new Error('raw payload would be here');
    libraryError.name = 'FailedYahooValidationError';
    yahooMock.quote.mockRejectedValue(libraryError);
    const { provider } = makeProvider();

    await expect(provider.getQuotes(['RELIANCE.NS'])).rejects.toMatchObject({
      name: 'FailedYahooValidationError',
    });
  });
});

describe('YahooProvider.searchInstruments', () => {
  it('keeps only Yahoo-listed Indian equities from a real search fixture', async () => {
    yahooMock.search.mockResolvedValue(searchReliance);
    const { provider } = makeProvider();

    const results = await provider.searchInstruments('reliance');
    expect(yahooMock.search).toHaveBeenCalledWith(
      'reliance',
      { quotesCount: 10, newsCount: 0 },
      { validateResult: false },
    );
    // Fixture contains: RELIANCE.NS + RPOWER.NS (NSE), three US listings
    // (NYQ/NCM/IOB), and two non-Yahoo rows — only the NSE ones survive.
    expect(results).toEqual([
      {
        symbol: 'RELIANCE',
        exchange: 'NSE',
        yahooSymbol: 'RELIANCE.NS',
        name: 'Reliance Industries Limited',
      },
      {
        symbol: 'RPOWER',
        exchange: 'NSE',
        yahooSymbol: 'RPOWER.NS',
        name: 'Reliance Power Limited',
      },
    ]);
  });

  it('skips the library for blank queries and guards malformed responses', async () => {
    const { provider } = makeProvider();
    expect(await provider.searchInstruments('   ')).toEqual([]);
    expect(yahooMock.search).not.toHaveBeenCalled();

    yahooMock.search.mockResolvedValue({ nonsense: true });
    expect(await provider.searchInstruments('reliance')).toEqual([]);
  });
});

describe('YahooProvider constructor wiring', () => {
  it('suppresses the survey notice and wraps fetch with the timeout layer', async () => {
    const upstream = vi.fn(async () => new Response('ok'));
    makeProvider({ fetch: upstream, timeoutMs: 999 });

    const options = yahooMock.constructorOptions[0] as {
      suppressNotices: string[];
      fetch: typeof fetch;
    };
    expect(options.suppressNotices).toEqual(['yahooSurvey']);
    expect(typeof options.fetch).toBe('function');
    expect(options.fetch).not.toBe(upstream); // timeout wrapper, not raw fetch

    const response = await options.fetch('http://example.test', {});
    expect(await response.text()).toBe('ok');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

describe('createTimeoutFetch', () => {
  it('aborts a slow upstream request with AbortError (the TIMEOUT shape)', async () => {
    const never: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    const timeoutFetch = createTimeoutFetch(20, never);

    await expect(timeoutFetch('http://slow.example', {})).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('passes a fast response straight through', async () => {
    const fast = vi.fn(async () => new Response('ok'));
    const timeoutFetch = createTimeoutFetch(1000, fast);

    const response = await timeoutFetch('http://fast.example', {});
    expect(await response.text()).toBe('ok');
    expect(fast).toHaveBeenCalledTimes(1);
  });
});
