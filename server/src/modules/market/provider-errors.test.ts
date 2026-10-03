import { describe, expect, it } from 'vitest';
import { classifyProviderError, MarketValidationError } from './provider-errors';

function namedError(name: string, message = 'boom'): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('classifyProviderError', () => {
  it('maps BadRequestError to badRequest (never counted)', () => {
    expect(classifyProviderError(namedError('BadRequestError'))).toEqual({
      status: 'badRequest',
      message: 'boom',
    });
  });

  it('maps validation failures to counted VALIDATION errors', () => {
    for (const name of ['FailedYahooValidationError', 'MarketValidationError', 'ZodError']) {
      expect(classifyProviderError(namedError(name))).toEqual({
        status: 'error',
        kind: 'VALIDATION',
        message: 'boom',
      });
    }
  });

  it('maps HTTP, timeout, network, and unknown errors to their kinds', () => {
    expect(classifyProviderError(namedError('HTTPError'))).toMatchObject({
      status: 'error',
      kind: 'HTTP',
    });
    expect(classifyProviderError(namedError('AbortError'))).toMatchObject({
      status: 'error',
      kind: 'TIMEOUT',
    });
    expect(classifyProviderError(namedError('TimeoutError'))).toMatchObject({
      status: 'error',
      kind: 'TIMEOUT',
    });
    // fetch()'s own failure mode is TypeError('fetch failed').
    expect(classifyProviderError(namedError('TypeError'))).toMatchObject({
      status: 'error',
      kind: 'NETWORK',
    });
    expect(classifyProviderError(new Error('surprise'))).toMatchObject({
      status: 'error',
      kind: 'UNKNOWN',
    });
  });

  it('handles non-Error values without crashing', () => {
    expect(classifyProviderError('plain string')).toEqual({
      status: 'error',
      kind: 'UNKNOWN',
      message: 'plain string',
    });
    expect(classifyProviderError(undefined)).toMatchObject({
      status: 'error',
      kind: 'UNKNOWN',
    });
  });
});

describe('MarketValidationError', () => {
  it('carries the stable name classifyProviderError keys on', () => {
    const error = new MarketValidationError('3 quote(s) yielded no usable data');
    expect(error.name).toBe('MarketValidationError');
    expect(error).toBeInstanceOf(Error);
    expect(classifyProviderError(error)).toMatchObject({
      status: 'error',
      kind: 'VALIDATION',
    });
  });
});
