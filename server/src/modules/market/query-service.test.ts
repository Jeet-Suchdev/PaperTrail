import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../lib/errors';
import { MarketQueryService } from './query-service';
import { TrackedSymbols } from './tracked-symbols';
import type { MarketService } from './market-service';
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
  const getQuotes = vi.fn(async (_symbols: string[]): Promise<Quote[]> => [makeQuote()]);
  const searchInstruments = vi.fn(async (_query: string) => [
    {
      symbol: 'RELIANCE',
      exchange: 'NSE' as const,
      yahooSymbol: 'RELIANCE.NS',
      name: 'Reliance Industries Limited',
    },
  ]);
  const service = { getQuotes, searchInstruments } as unknown as MarketService;
  const trackedSymbols = new TrackedSymbols();
  const queryService = new MarketQueryService({ service, trackedSymbols });
  return { queryService, getQuotes, searchInstruments, trackedSymbols };
}

describe('MarketQueryService.getQuote', () => {
  it('returns the quote and tracks the symbol only after it was found', async () => {
    const { queryService, trackedSymbols, getQuotes } = setup();

    const quote = await queryService.getQuote('reliance', 'NSE');
    expect(quote).toMatchObject({ symbol: 'RELIANCE', pricePaise: 116770 });
    expect(getQuotes).toHaveBeenCalledWith(['RELIANCE.NS']);
    expect(trackedSymbols.list()).toEqual(['RELIANCE.NS']);
  });

  it('404s and tracks nothing when the symbol is unknown upstream', async () => {
    const { queryService, getQuotes, trackedSymbols } = setup();
    getQuotes.mockResolvedValue([]);

    await expect(queryService.getQuote('NOPE', 'NSE')).rejects.toBeInstanceOf(NotFoundError);
    expect(trackedSymbols.size).toBe(0); // unknown symbols are never tracked
  });

  it('404s symbols that cannot map at all, without calling upstream', async () => {
    const { queryService, getQuotes, trackedSymbols } = setup();

    await expect(queryService.getQuote('RELIANCE.NS', 'NSE')).rejects.toBeInstanceOf(NotFoundError);
    expect(getQuotes).not.toHaveBeenCalled();
    expect(trackedSymbols.size).toBe(0);
  });

  it('serves the simulated fallback quote during an outage (flagged)', async () => {
    const { queryService, getQuotes } = setup();
    getQuotes.mockResolvedValue([makeQuote({ isSimulated: true, pricePaise: 999 })]);

    const quote = await queryService.getQuote('RELIANCE', 'NSE');
    expect(quote).toMatchObject({ isSimulated: true, pricePaise: 999 });
  });

  it('supports BSE quotes', async () => {
    const { queryService, getQuotes, trackedSymbols } = setup();
    getQuotes.mockResolvedValue([makeQuote({ symbol: 'TCS', exchange: 'BSE' })]);

    await queryService.getQuote('TCS', 'BSE');
    expect(getQuotes).toHaveBeenCalledWith(['TCS.BO']);
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
