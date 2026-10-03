// Manual LIVE smoke test for the Yahoo provider — hits the real API.
// Run: pnpm --filter server smoke:market
// NOT part of `pnpm test` (tests never touch the network).

import { YahooProvider } from '../modules/market/yahoo-provider';

async function main(): Promise<void> {
  const provider = new YahooProvider({ timeoutMs: 10_000 });
  const quotes = await provider.getQuotes(['RELIANCE.NS', 'TCS.BO', 'INFY.NS']);
  console.log(`getQuotes returned ${quotes.length}/3 quote(s):`);
  console.log(JSON.stringify(quotes, null, 2));

  const search = await provider.searchInstruments('reliance');
  console.log(`searchInstruments returned ${search.length} result(s):`);
  console.log(JSON.stringify(search, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const name = error instanceof Error ? error.name : 'unknown';
    const message = error instanceof Error ? error.message : String(error);
    console.error(`smoke:market FAILED (${name}): ${message}`);
    process.exit(1);
  });
