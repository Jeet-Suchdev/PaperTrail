import { describe, expect, it } from 'vitest';
import { isMarketOpen } from './market-hours';

/** The instant at which the given wall-clock IST time occurs (fixed UTC+05:30). */
function ist(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - 5.5 * 60 * 60 * 1_000);
}

// Oct 2 2026 = Friday, Oct 3 = Saturday, Oct 4 = Sunday.
// (Oct 2 is Gandhi Jayanti — an actual NSE holiday. Holidays are NOT modelled;
// see the comment in market-hours.ts.)
const cases: Array<{ label: string; at: Date; open: boolean }> = [
  { label: '09:14 IST Friday (before open)', at: ist(2026, 10, 2, 9, 14), open: false },
  { label: '09:15 IST Friday (open bell)', at: ist(2026, 10, 2, 9, 15), open: true },
  { label: '12:00 IST Friday (mid-session)', at: ist(2026, 10, 2, 12, 0), open: true },
  { label: '15:29 IST Friday (last minute)', at: ist(2026, 10, 2, 15, 29), open: true },
  { label: '15:30 IST Friday (close bell)', at: ist(2026, 10, 2, 15, 30), open: false },
  { label: '15:31 IST Friday (after close)', at: ist(2026, 10, 2, 15, 31), open: false },
  { label: '10:00 IST Saturday', at: ist(2026, 10, 3, 10, 0), open: false },
  { label: '10:00 IST Sunday', at: ist(2026, 10, 4, 10, 0), open: false },
];

describe('isMarketOpen', () => {
  it.each(cases)('$label -> open=$open', ({ at, open }) => {
    expect(isMarketOpen(at)).toBe(open);
  });

  it('reads the IST clock, not the UTC clock', () => {
    // 15:00 UTC sits inside a naive 09:15–15:30 comparison, but it is
    // 20:30 IST — long closed. A UTC-clock implementation would be wrong here.
    expect(isMarketOpen(new Date(Date.UTC(2026, 9, 1, 15, 0)))).toBe(false);
    // 04:00 UTC is outside a naive UTC window but it is 09:30 IST — open.
    expect(isMarketOpen(new Date(Date.UTC(2026, 9, 2, 4, 0)))).toBe(true);
  });

  it('handles instants whose IST calendar day differs from the UTC day', () => {
    const instant = new Date(Date.UTC(2026, 9, 1, 22, 0)); // Thu 22:00 UTC
    // In IST this is Friday Oct 2, 03:30 — a different calendar day.
    const istShifted = new Date(instant.getTime() + 5.5 * 60 * 60 * 1_000);
    expect(istShifted.getUTCDay()).toBe(5); // Friday in IST
    expect(istShifted.getUTCDate()).toBe(2); // Oct 2 in IST
    // 03:30 IST is before the open bell, so closed either way.
    expect(isMarketOpen(instant)).toBe(false);
    // Midnight IST (weekday flips relative to UTC): Mon 18:30 UTC = Tue 00:00 IST.
    expect(isMarketOpen(new Date(Date.UTC(2026, 9, 6, 18, 30)))).toBe(false);
  });
});
