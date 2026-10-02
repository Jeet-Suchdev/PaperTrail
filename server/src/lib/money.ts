// Money crosses the API boundary as integer paise. The DB stores BigInt;
// JSON cannot carry BigInt, so routes convert at the edge with these helpers
// and nowhere else. Every conversion is checked — a value that would not
// survive the round trip as an exact integer is a bug, not something to
// round silently.

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** BigInt paise -> JSON-safe number. Throws if the value cannot be exact. */
export function paiseToNumber(paise: bigint): number {
  const n = Number(paise);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`paiseToNumber: ${paise.toString()} is not a safe integer`);
  }
  return n;
}

/** JSON-safe number -> BigInt paise. Rejects fractions and unsafe values. */
export function numberToPaise(value: number): bigint {
  if (!Number.isInteger(value)) {
    throw new Error(`numberToPaise: ${value} is not an integer (money is whole paise)`);
  }
  if (Math.abs(value) > MAX_SAFE) {
    throw new Error(`numberToPaise: ${value} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return BigInt(value);
}

/**
 * Rupee float -> integer paise. This is the ONLY place a rupee-denominated
 * float becomes paise (the market-provider boundary); everything downstream
 * is integer paise. Rejects NaN, Infinity, negatives, and unsafe results —
 * bad upstream data must fail loudly, not round into a wrong price.
 */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) {
    throw new Error(`rupeesToPaise: ${rupees} is not a finite number`);
  }
  if (rupees < 0) {
    throw new Error(`rupeesToPaise: ${rupees} is negative`);
  }
  const paise = Math.round(rupees * 100);
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`rupeesToPaise: ${rupees} exceeds the safe integer range`);
  }
  return paise;
}

// Display-only. Dividing by 100 here is the single allowed float step —
// it happens inside the formatter, after all calculations are done.
// The client keeps a copy of this function (client/src/lib/money.ts).
export function formatInr(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new Error(`formatInr: ${paise} is not an integer number of paise`);
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
