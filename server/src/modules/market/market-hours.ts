// Pure market-hours check for the NSE/BSE regular session.
//
// Session: 09:15–15:30 IST, Monday–Friday. The window is half-open —
// open from 09:15:00 inclusive to 15:30:00 exclusive (at exactly 15:30
// the market counts as closed).
//
// IST is a fixed UTC+05:30 offset with NO daylight saving time, so the
// conversion below never needs a zone database — just add the offset and
// read the UTC fields of the shifted instant.
//
// NOT COVERED: exchange holidays (e.g. Gandhi Jayanti on Oct 2). Keeping
// this clock-only is deliberate: Yahoo *does* expose a per-symbol
// `marketState` ('REGULAR' | 'CLOSED' | 'POST' | ...) that would catch
// holidays for free, but it only arrives when we fetch a quote, so it can't
// gate a pure clock check. Checkpoint 3+ may use `marketState` as an extra
// signal once quotes are flowing; this function stays holiday-blind until
// then.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000; // UTC+05:30, no DST
const SESSION_START_MIN = 9 * 60 + 15; // 09:15 IST
const SESSION_END_MIN = 15 * 60 + 30; // 15:30 IST (exclusive)

/** Is the NSE/BSE regular session open at `now`? Inject the clock in callers. */
export function isMarketOpen(now: Date): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay(); // 0=Sun … 6=Sat, in IST
  if (day === 0 || day === 6) return false;
  const minutesOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutesOfDay >= SESSION_START_MIN && minutesOfDay < SESSION_END_MIN;
}
