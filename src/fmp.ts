const FMP_BASE = "https://financialmodelingprep.com/stable";

async function fmpGet(path: string, apiKey: string): Promise<any> {
  const url = `${FMP_BASE}${path}${path.includes("?") ? "&" : "?"}apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

// VERIFY: field names below are my best understanding of FMP's "stable" tier as of my
// training cutoff — confirm against a live response before trusting this in production.

export async function getDcf(symbol: string, apiKey: string) {
  const row = await fmpGet(`/discounted-cash-flow?symbol=${symbol}`, apiKey);
  return row?.dcf ?? null;
}

export async function getPriceTarget(symbol: string, apiKey: string) {
  const row = await fmpGet(`/price-target-consensus?symbol=${symbol}`, apiKey);
  if (!row) return null;
  return {
    consensus: row.targetConsensus ?? null,
    high: row.targetHigh ?? null,
    low: row.targetLow ?? null,
  };
}

export async function getRating(symbol: string, apiKey: string) {
  const row = await fmpGet(`/ratings-snapshot?symbol=${symbol}`, apiKey);
  return row?.ratingRecommendation ?? row?.rating ?? null; // confirm exact field
}

export async function getBeta(symbol: string, apiKey: string) {
  const row = await fmpGet(`/profile?symbol=${symbol}`, apiKey);
  return row?.beta ?? null;
}

export async function getNetDebtToEbitda(symbol: string, apiKey: string) {
  const row = await fmpGet(`/key-metrics-ttm?symbol=${symbol}`, apiKey);
  return row?.netDebtToEBITDATTM ?? null; // confirm exact field
}

// Revision trend: FMP's free/lower tiers don't reliably expose point-in-time historical EPS
// estimate snapshots, so use analyst upgrade/downgrade activity over ~90 days as the proxy
// signal instead — it's a reasonable stand-in and IS available on lower tiers.
export async function getRevisionTrend(symbol: string, apiKey: string): Promise<"Upward" | "Downward" | "Flat/mixed" | null> {
  const url = `${FMP_BASE}/grades-historical?symbol=${symbol}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const rows: any[] = await res.json();
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const recent = rows.filter(r => new Date(r.date).getTime() >= cutoff);
  if (recent.length === 0) return null;
  const upgrades = recent.filter(r => r.action === "upgrade" || r.newGrade > r.previousGrade).length;
  const downgrades = recent.filter(r => r.action === "downgrade" || r.newGrade < r.previousGrade).length;
  if (upgrades > downgrades) return "Upward";
  if (downgrades > upgrades) return "Downward";
  return "Flat/mixed";
}

export async function getPriceHistory(symbol: string, apiKey: string): Promise<Array<{ date: string; close: number }> | null> {
  const url = `${FMP_BASE}/historical-price-eod/full?symbol=${symbol}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const rows = Array.isArray(data) ? data : data?.historical;
  if (!rows?.length) return null;
  return rows.map((r: any) => ({ date: r.date, close: r.close })).reverse(); // oldest→newest
}
