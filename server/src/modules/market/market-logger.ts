// Console-backed market logger with a stable prefix. Accepts a logger via
// constructor options in tests so assertions are simple. Rule: log symbols,
// counts, and error NAMES — never raw upstream payloads.

export interface MarketLogger {
  info(message: string): void;
  warn(message: string): void;
}

export function createConsoleMarketLogger(): MarketLogger {
  return {
    info: (message) => console.log(`[market] ${message}`),
    warn: (message) => console.warn(`[market] ${message}`),
  };
}
