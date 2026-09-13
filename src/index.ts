import { getDcf, getPriceTarget, getRating, getBeta, getNetDebtToEbitda, getRevisionTrend, getPriceHistory } from "./fmp";
import { technicalEntrySignal } from "./technical";

export interface Env {
  FMP_API_KEY: string;
  WORKER_SHARED_SECRET: string;
}

function riskBucket(targetHigh: number | null, targetLow: number | null, price: number | null,
                     beta: number | null, netDebtEbitda: number | null): "Low" | "Medium" | "High" | null {
  const scores: number[] = []; // 0=Low,1=Medium,2=High
  if (targetHigh !== null && targetLow !== null && price) {
    const spread = (targetHigh - targetLow) / price;
    scores.push(spread < 0.15 ? 0 : spread <= 0.35 ? 1 : 2);
  }
  if (beta !== null) scores.push(beta < 1.0 ? 0 : beta <= 1.5 ? 1 : 2);
  if (netDebtEbitda !== null) scores.push(netDebtEbitda < 1 ? 0 : netDebtEbitda <= 3 ? 1 : 2);
  if (scores.length === 0) return null;
  const counts = [0, 0, 0];
  scores.forEach(s => counts[s]++);
  const max = Math.max(...counts);
  const tied = counts.map((c, i) => (c === max ? i : -1)).filter(i => i >= 0);
  const bucket = Math.max(...tied); // ties → more cautious
  return (["Low", "Medium", "High"] as const)[bucket];
}

function confidenceBucket(dcf: number | null, price: number | null, wsTarget: number | null,
                           technical: string | null, revisionTrend: string | null): "Low" | "Medium" | "High" | null {
  if (price === null) return null;
  let favorable = 0, total = 0;
  if (dcf !== null) { total++; if (price < dcf) favorable++; }
  if (wsTarget !== null) { total++; if (price < wsTarget) favorable++; }
  if (technical !== null) { total++; if (technical === "Favorable") favorable++; }
  if (total === 0) return null;
  const signalScore = favorable <= 1 ? 0 : favorable === 2 ? 1 : 2;
  if (revisionTrend === null) return (["Low", "Medium", "High"] as const)[signalScore];
  const trendScore = revisionTrend === "Downward" ? 0 : revisionTrend === "Upward" ? 2 : 1;
  const finalScore = Math.min(signalScore, trendScore); // tie → more conservative
  return (["Low", "Medium", "High"] as const)[finalScore];
}

async function calculateOne(symbol: string, env: Env) {
  const warnings: string[] = [];
  const [dcf, target, rating, beta, netDebtEbitda, revisionTrend, history] = await Promise.all([
    getDcf(symbol, env.FMP_API_KEY),
    getPriceTarget(symbol, env.FMP_API_KEY),
    getRating(symbol, env.FMP_API_KEY),
    getBeta(symbol, env.FMP_API_KEY),
    getNetDebtToEbitda(symbol, env.FMP_API_KEY),
    getRevisionTrend(symbol, env.FMP_API_KEY),
    getPriceHistory(symbol, env.FMP_API_KEY),
  ]);

  if (dcf === null) warnings.push("no DCF model");
  if (!target) warnings.push("no analyst coverage");
  if (beta === null) warnings.push("no beta");
  if (netDebtEbitda === null) warnings.push("no net debt/EBITDA");
  if (revisionTrend === null) warnings.push("no revision data");

  const lastPrice = history?.length ? history[history.length - 1].close : null;
  const technical = history ? technicalEntrySignal(history) : null;
  if (technical === null) warnings.push("insufficient price history for technical signal");

  const risk = riskBucket(target?.high ?? null, target?.low ?? null, lastPrice, beta, netDebtEbitda);
  const confidence = confidenceBucket(dcf, lastPrice, target?.consensus ?? null, technical, revisionTrend);

  return {
    ticker: symbol,
    fairValue: dcf,
    wsTarget: target?.consensus ?? null,
    wsRating: rating,
    risk,
    confidence,
    warnings,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.WORKER_SHARED_SECRET}`) return new Response("Unauthorized", { status: 401 });

    const { tickers } = await request.json() as { tickers: string[] };
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return new Response(JSON.stringify({ error: "tickers[] required" }), { status: 400 });
    }

    const results = await Promise.all(tickers.map(t => calculateOne(t, env)));
    return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
  },
};
