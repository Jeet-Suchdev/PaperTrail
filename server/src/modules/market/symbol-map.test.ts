import { describe, expect, it } from 'vitest';
import type { Exchange } from './types';
import { fromYahooSymbol, toYahooSymbol } from './symbol-map';

describe('toYahooSymbol', () => {
  it('maps NSE to .NS and BSE to .BO', () => {
    expect(toYahooSymbol('RELIANCE', 'NSE')).toBe('RELIANCE.NS');
    expect(toYahooSymbol('RELIANCE', 'BSE')).toBe('RELIANCE.BO');
    expect(toYahooSymbol('M&M', 'NSE')).toBe('M&M.NS');
    expect(toYahooSymbol('M&M', 'BSE')).toBe('M&M.BO');
    expect(toYahooSymbol('BAJAJ-AUTO', 'NSE')).toBe('BAJAJ-AUTO.NS');
    expect(toYahooSymbol('BAJAJ-AUTO', 'BSE')).toBe('BAJAJ-AUTO.BO');
    expect(toYahooSymbol('3MINDIA', 'NSE')).toBe('3MINDIA.NS');
  });

  it('uppercases the symbol', () => {
    expect(toYahooSymbol('reliance', 'NSE')).toBe('RELIANCE.NS');
  });

  it('rejects dots, whitespace, bad characters, empty and over-long symbols', () => {
    expect(toYahooSymbol('RELIANCE.NS', 'NSE')).toBeNull(); // no suffix smuggling
    expect(toYahooSymbol('RELIANCE .NS', 'NSE')).toBeNull();
    expect(toYahooSymbol(' RELIANCE', 'NSE')).toBeNull();
    expect(toYahooSymbol('RELIANCE ', 'NSE')).toBeNull();
    expect(toYahooSymbol('RELIANCE X', 'NSE')).toBeNull();
    expect(toYahooSymbol('RELIANCE!', 'NSE')).toBeNull();
    expect(toYahooSymbol('', 'NSE')).toBeNull();
    expect(toYahooSymbol('A'.repeat(21), 'NSE')).toBeNull();
    expect(toYahooSymbol('A'.repeat(20), 'NSE')).toBe('A'.repeat(20) + '.NS'); // boundary
  });

  it('rejects an unknown exchange passed at runtime', () => {
    expect(toYahooSymbol('RELIANCE', 'NYSE' as Exchange)).toBeNull();
  });
});

describe('fromYahooSymbol', () => {
  it('maps .NS and .BO back to symbol + exchange', () => {
    expect(fromYahooSymbol('RELIANCE.NS')).toEqual({ symbol: 'RELIANCE', exchange: 'NSE' });
    expect(fromYahooSymbol('TCS.BO')).toEqual({ symbol: 'TCS', exchange: 'BSE' });
    expect(fromYahooSymbol('M&M.NS')).toEqual({ symbol: 'M&M', exchange: 'NSE' });
    expect(fromYahooSymbol('BAJAJ-AUTO.BO')).toEqual({ symbol: 'BAJAJ-AUTO', exchange: 'BSE' });
  });

  it('uppercases the input', () => {
    expect(fromYahooSymbol('reliance.ns')).toEqual({ symbol: 'RELIANCE', exchange: 'NSE' });
  });

  it('rejects missing or unknown suffixes, extra dots and whitespace', () => {
    expect(fromYahooSymbol('RELIANCE')).toBeNull(); // no suffix
    expect(fromYahooSymbol('RELIANCE.XX')).toBeNull(); // unknown suffix
    expect(fromYahooSymbol('FOO.BAR.NS')).toBeNull(); // inner dot
    expect(fromYahooSymbol('RELIANCE .NS')).toBeNull();
    expect(fromYahooSymbol('.NS')).toBeNull(); // empty bare part
    expect(fromYahooSymbol('')).toBeNull();
    expect(fromYahooSymbol('RELIANCE.NS EXTRA')).toBeNull();
  });

  it('round-trips through toYahooSymbol', () => {
    const pairs: Array<[string, Exchange]> = [
      ['RELIANCE', 'NSE'],
      ['RELIANCE', 'BSE'],
      ['M&M', 'NSE'],
      ['BAJAJ-AUTO', 'BSE'],
      ['3MINDIA', 'NSE'],
    ];
    for (const [symbol, exchange] of pairs) {
      const yahoo = toYahooSymbol(symbol, exchange);
      expect(yahoo).not.toBeNull();
      expect(fromYahooSymbol(yahoo!)).toEqual({ symbol, exchange });
    }
  });
});
