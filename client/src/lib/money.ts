// The only place money gets formatted in the client (display-only mirror of
// formatInr in server/src/lib/money.ts). Input is integer paise; all
// calculations stay in paise — the /100 happens only inside this formatter.
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
