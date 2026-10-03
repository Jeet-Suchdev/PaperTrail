import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricePoller } from './poller';
import { TrackedSymbols } from './tracked-symbols';
import type { MarketService } from './market-service';

const OPEN_DAY = new Date('2026-10-01T06:00:00.000Z'); // Thu 11:30 IST
const CLOSED_DAY = new Date('2026-10-03T06:00:00.000Z'); // Sat — market closed

function stubService() {
  const refreshQuotes = vi.fn(async (_symbols: string[]): Promise<unknown[]> => []);
  const service = { refreshQuotes, getQuotes: refreshQuotes } as unknown as MarketService;
  return { service, refreshQuotes, getQuotes: refreshQuotes };
}

function makePoller(
  service: MarketService,
  now: () => Date,
  intervalSeconds = 10,
  marketOpen?: (now: Date) => boolean,
) {
  const trackedSymbols = new TrackedSymbols();
  trackedSymbols.add('RELIANCE', 'NSE');
  const logger = { info: vi.fn(), warn: vi.fn() };
  const poller = new PricePoller({
    service,
    trackedSymbols,
    intervalSeconds,
    logger,
    now,
    marketOpen,
  });
  return { poller, trackedSymbols, logger };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PricePoller', () => {
  it('polls tracked symbols while the market is open and chains ticks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OPEN_DAY);
    const { service, getQuotes } = stubService();
    const { poller } = makePoller(
      service,
      () => new Date(),
      10,
      () => true,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getQuotes).toHaveBeenCalledTimes(1);
    expect(getQuotes).toHaveBeenCalledWith(['RELIANCE.NS']);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(getQuotes).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getQuotes).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('does not fetch outside market hours (the cache serves the last close)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLOSED_DAY);
    const { service, getQuotes } = stubService();
    const { poller } = makePoller(
      service,
      () => new Date(),
      10,
      () => false,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getQuotes).not.toHaveBeenCalled();

    poller.stop();
  });

  it('uses real isMarketOpen by default (weekend = closed)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLOSED_DAY);
    const { service, getQuotes } = stubService();
    const { poller } = makePoller(service, () => new Date(), 10);

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getQuotes).not.toHaveBeenCalled(); // Saturday

    vi.setSystemTime(OPEN_DAY);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getQuotes).toHaveBeenCalledTimes(1); // Thursday

    poller.stop();
  });

  it('never overlaps ticks: a slow tick blocks the next one', async () => {
    vi.useFakeTimers();
    const { service, getQuotes } = stubService();
    let release: (() => void) | undefined;
    getQuotes.mockImplementationOnce(
      () => new Promise<unknown[]>((resolve) => (release = () => resolve([]))),
    );
    const { poller } = makePoller(
      service,
      () => new Date(),
      10,
      () => true,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getQuotes).toHaveBeenCalledTimes(1);

    // Several intervals pass while the first tick is still running.
    await vi.advanceTimersByTimeAsync(50_000);
    expect(getQuotes).toHaveBeenCalledTimes(1); // no second tick started
    expect(poller.isTicking).toBe(true);

    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(poller.isTicking).toBe(false);
    // The next tick is scheduled only now, one interval from completion.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getQuotes).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('survives a throwing service and keeps ticking', async () => {
    vi.useFakeTimers();
    const { service, getQuotes } = stubService();
    getQuotes.mockRejectedValueOnce(new Error('boom'));
    const { poller, logger } = makePoller(
      service,
      () => new Date(),
      10,
      () => true,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('poll tick failed'));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(getQuotes).toHaveBeenCalledTimes(2); // loop continued

    poller.stop();
  });

  it('does nothing when no symbols are tracked', async () => {
    vi.useFakeTimers();
    const { service, getQuotes } = stubService();
    const trackedSymbols = new TrackedSymbols();
    const poller = new PricePoller({
      service,
      trackedSymbols,
      intervalSeconds: 10,
      logger: { info: vi.fn(), warn: vi.fn() },
      marketOpen: () => true,
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getQuotes).not.toHaveBeenCalled();

    poller.stop();
  });

  it('stop() clears the pending timer and is idempotent', async () => {
    vi.useFakeTimers();
    const { service, getQuotes } = stubService();
    const { poller } = makePoller(
      service,
      () => new Date(),
      10,
      () => true,
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    poller.stop(); // no throw
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getQuotes).toHaveBeenCalledTimes(1); // nothing scheduled after stop
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unrefs its timer so it can never hold the process open (real timers)', async () => {
    const { service } = stubService();
    const { poller } = makePoller(
      service,
      () => new Date(),
      3600,
      () => true,
    );
    const spy = vi.spyOn(globalThis, 'setTimeout');

    poller.start();
    // The first tick runs immediately and only schedules the next one after
    // its fetch resolves, so let the microtask queue drain first.
    await new Promise((resolve) => setImmediate(resolve));
    const handle = spy.mock.results[0]!.value as { hasRef?: () => boolean };
    expect(handle.hasRef?.()).toBe(false); // unref'd

    poller.stop();
    spy.mockRestore();
  });
});
