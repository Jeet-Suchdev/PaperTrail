import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../lib/errors';
import { MarketQueryService } from './query-service';
import { TrackedSymbols } from './tracked-symbols';
import type { MarketService, QuoteLookup } from './market-service';
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

function setup() {
  const getQuote = vi.fn(async (_yahooSymbol: string): Promise<QuoteLookup> => ({
    status: 'ok',
    quote: makeQuote(),
  }));
  const searchInstruments = vi.fn(async (_query: string) => [
    {
      symbol: 'RELIANCE',
      exchange: 'NSE' as const,
      yahooSymbol: 'RELIANCE.NS',
      name: 'Reliance Industries Limited',
    },
  ]);
  const service = { getQuote, searchInstruments } as unknown as MarketService;
  const trackedSymbols = new TrackedSymbols();
  const queryService = new MarketQueryService({ service, trackedSymbols });
  return { queryService, getQuote, searchInstruments, trackedSymbols };
}

describe('MarketQueryService.getQuote', () => {
  it('returns the quote and tracks the symbol only after it was found', async () => {
    const { queryService, trackedSymbols, getQuote } = setup();

    const quote = await queryService.getQuote('reliance', 'NSE');
    expect(quote).toMatchObject({ symbol: 'RELIANCE', pricePaise: 116770 });
    expect(getQuote).toHaveBeenCalledWith('RELIANCE.NS');
    expect(trackedSymbols.list()).toEqual(['RELIANCE.NS']);
  });

  it('404s and tracks nothing when the symbol is unknown upstream', async () => {
    const { queryService, getQuote, trackedSymbols } = setup();
    getQuote.mockResolvedValue({ status: 'notFound' });

    await expect(queryService.getQuote('NOPE', 'NSE')).rejects.toBeInstanceOf(NotFoundError);
    expect(trackedSymbols.size).toBe(0); // unknown symbols are never tracked
  });

  it('503s (never 404) when the deadline expired and nothing is cached', async () => {
    const { queryService, getQuote, trackedSymbols } = setup();
    getQuote.mockResolvedValue({ status: 'unavailable' });

    await expect(queryService.getQuote('RELIANCE', 'NSE')).rejects.toMatchObject({
      code: 'PRICE_UNAVAILABLE',
      status: 503,
    });
    expect(trackedSymbols.size).toBe(0);
  });

  it('404s symbols that cannot map at all, without calling upstream', async () => {
    const { queryService, getQuote, trackedSymbols } = setup();

    await expect(queryService.getQuote('RELIANCE.NS', 'NSE')).rejects.toBeInstanceOf(NotFoundError);
    expect(getQuote).not.toHaveBeenCalled();
    expect(trackedSymbols.size).toBe(0);
  });

  it('serves the simulated fallback quote during an outage (flagged)', async () => {
    const { queryService, getQuote } = setup();
    getQuote.mockResolvedValue({
      status: 'ok' as const,
      quote: makeQuote({ isSimulated: true, pricePaise: 999 }),
    });

    const quote = await queryService.getQuote('RELIANCE', 'NSE');
    expect(quote).toMatchObject({ isSimulated: true, pricePaise: 999 });
  });

  it('supports BSE quotes', async () => {
    const { queryService, getQuote, trackedSymbols } = setup();
    getQuote.mockResolvedValue({
      status: 'ok' as const,
      quote: makeQuote({ symbol: 'TCS', exchange: 'BSE' }),
    });

    await queryService.getQuote('TCS', 'BSE');
    expect(getQuote).toHaveBeenCalledWith('TCS.BO');
    expect(trackedSymbols.list()).toEqual(['TCS.BO']);
  });
});

describe('MarketQueryService.search', () => {
  it('delegates to the market service (which owns the 60s cache)', async () => {
    const { queryService, searchInstruments } = setup();

    const results = await queryService.search('reliance');
    expect(searchInstruments).toHaveBeenCalledWith('reliance');
    expect(results[0]!.symbol).toBe('RELIANCE');
  });
});
