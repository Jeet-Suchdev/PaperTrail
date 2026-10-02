// Day-change percent derived from INTEGER paise values, never from an
// upstream float — a Quote's changePaise and changePercent are computed from
// the same integers, so they can never disagree.
//
// Scaling: (change / prevClose) is a fraction; scaled by 1e4 it becomes
// 2-decimal percent in integer space (100% × 100 for the decimals), then
// divided by 100 to restore a number. Multiplying money values by 100 stays
// exclusive to rupeesToPaise so the money-rule grep pattern stays clean.
export function changePercentFromPaise(changePaise: number, prevClosePaise: number): number {
  if (prevClosePaise === 0) return 0; // no previous close -> no percent (never ÷ 0)
  return Math.round((changePaise / prevClosePaise) * 1e4) / 100;
}
