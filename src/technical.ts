function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function technicalEntrySignal(history: Array<{ close: number }>): "Favorable" | "Neutral" | "Unfavorable" | null {
  const closes = history.map(h => h.close);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const r = rsi(closes, 14);
  const last = closes[closes.length - 1];
  if (sma50 === null || sma200 === null || r === null) return null;

  const uptrend = sma50 > sma200;
  const oversoldRecovering = r >= 30 && r <= 50;
  const overbought = r > 70;
  const nearOrBelowSma200 = last <= sma200 * 1.03;

  if (uptrend && (oversoldRecovering || nearOrBelowSma200) && !overbought) return "Favorable";
  if (overbought || (!uptrend && r > 60)) return "Unfavorable";
  return "Neutral";
}
