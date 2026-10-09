// Tool logic. Every function here is pure: it takes a `market` object (see data.js)
// plus arguments and returns plain JSON. The MCP server in server.js is a thin wrapper.
//
// Design rule: these tools return data and arithmetic. They never recommend.

import { termsSummary } from './issuers.js';

export const DISCLAIMER =
  'Information only, not financial advice. Figures come from public third-party data and may be delayed or wrong. Verify with the issuer before acting.';

const byDesc = (key) => (a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity);
const round2 = (n) => Math.round(n * 100) / 100;

export function median(values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function listAssets(market, { chain, kind, minTvlUsd = 1_000_000, limit = 20, sortBy = 'tvlUsd' } = {}) {
  let rows = market.assets.filter((a) => a.tvlUsd >= minTvlUsd);
  if (chain) rows = rows.filter((a) => a.chain.toLowerCase() === chain.toLowerCase());
  if (kind) rows = rows.filter((a) => a.kind === kind);
  rows = [...rows].sort(byDesc(sortBy === 'apy' ? 'apyPercent' : 'tvlUsd'));
  return {
    fetchedAt: market.fetchedAt,
    source: market.source,
    matched: rows.length,
    assets: rows.slice(0, limit),
    disclaimer: DISCLAIMER,
  };
}

export function getAsset(market, symbol) {
  const s = String(symbol ?? '').toUpperCase();
  const rows = market.assets.filter((a) => a.symbol === s).sort(byDesc('tvlUsd'));
  if (!rows.length) {
    return { symbol: s, found: false, hint: 'Call list_rwa_yields to see available symbols.', disclaimer: DISCLAIMER };
  }
  return {
    fetchedAt: market.fetchedAt,
    source: market.source,
    symbol: s,
    found: true,
    kind: rows[0].kind,
    description: rows[0].description,
    projects: [...new Set(rows.map((r) => r.project))],
    chains: [...new Set(rows.map((r) => r.chain))],
    totalTvlUsd: rows.reduce((sum, r) => sum + r.tvlUsd, 0),
    terms: termsSummary(s),
    deployments: rows,
    disclaimer: DISCLAIMER,
  };
}

function aggregateBySymbol(rows) {
  const m = new Map();
  for (const r of rows) {
    const cur = m.get(r.symbol) ?? { symbol: r.symbol, totalTvlUsd: 0, chains: new Set(), maxApyPercent: null };
    cur.totalTvlUsd += r.tvlUsd;
    cur.chains.add(r.chain);
    if (r.apyPercent != null && (cur.maxApyPercent == null || r.apyPercent > cur.maxApyPercent)) cur.maxApyPercent = r.apyPercent;
    m.set(r.symbol, cur);
  }
  return [...m.values()]
    .map((x) => ({ ...x, chains: [...x.chains] }))
    .sort(byDesc('totalTvlUsd'));
}

export function marketSummary(market) {
  const treasuries = market.assets.filter((a) => a.kind === 'treasury');
  const other = market.assets.filter((a) => a.kind !== 'treasury');
  const agg = aggregateBySymbol(treasuries);
  return {
    fetchedAt: market.fetchedAt,
    source: market.source,
    tokenizedTreasuries: {
      distinctTokens: agg.length,
      deployments: treasuries.length,
      totalTvlUsd: treasuries.reduce((s, a) => s + a.tvlUsd, 0),
      medianApyPercent: median(treasuries.filter((a) => a.tvlUsd >= 1_000_000).map((a) => a.apyPercent)),
      topByTvl: agg.slice(0, 5),
    },
    otherRwa: {
      deployments: other.length,
      totalTvlUsd: other.reduce((s, a) => s + a.tvlUsd, 0),
    },
    disclaimer: DISCLAIMER,
  };
}

export function compareYield(market, { currentApyPercent, amountUsd = 10_000, horizonDays = 365, minTvlUsd = 50_000_000 }) {
  const candidates = market.assets
    .filter((a) => a.kind === 'treasury' && a.tvlUsd >= minTvlUsd && a.apyPercent != null)
    .sort(byDesc('apyPercent'));
  const years = horizonDays / 365;
  const simpleInterest = (apy) => round2(amountUsd * (apy / 100) * years);
  const inputs = { currentApyPercent, amountUsd, horizonDays, minTvlUsd };
  if (!candidates.length) {
    return { inputs, bestTokenizedTreasury: null, note: 'No tokenized treasury met the liquidity floor.', disclaimer: DISCLAIMER };
  }
  const best = candidates[0];
  const current = simpleInterest(currentApyPercent);
  const alt = simpleInterest(best.apyPercent);
  return {
    fetchedAt: market.fetchedAt,
    source: market.source,
    inputs,
    bestTokenizedTreasury: {
      symbol: best.symbol,
      project: best.project,
      chain: best.chain,
      apyPercent: best.apyPercent,
      tvlUsd: best.tvlUsd,
    },
    projectedInterestUsd: { current, bestTokenizedTreasury: alt, difference: round2(alt - current) },
    assumptions: [
      'Simple interest, no compounding',
      'Ignores fees, minimums, KYC/eligibility, taxes, redemption timing, smart-contract and issuer risk',
      `Only deployments with at least $${minTvlUsd.toLocaleString('en-US')} TVL were considered`,
    ],
    disclaimer: DISCLAIMER,
  };
}

// History: one row per daily snapshot for a symbol (optionally one chain).
// `snapshots` is [{ day: 'YYYY-MM-DD', assets: [...] }] in any order.
export function historySeries(snapshots, { symbol, chain, days = 30 } = {}) {
  const s = String(symbol ?? '').toUpperCase();
  const series = [...snapshots]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(-days)
    .map((snap) => {
      const m = snap.assets.filter((a) => a.symbol === s && (!chain || a.chain.toLowerCase() === chain.toLowerCase()));
      const totalTvlUsd = m.reduce((x, a) => x + a.tvlUsd, 0);
      const w = m.filter((a) => a.apyPercent != null && a.tvlUsd > 0);
      const wsum = w.reduce((x, a) => x + a.tvlUsd, 0);
      const apy = wsum ? round2(w.reduce((x, a) => x + a.apyPercent * a.tvlUsd, 0) / wsum) : null;
      return { day: snap.day, deployments: m.length, totalTvlUsd, tvlWeightedApyPercent: apy };
    });
  const first = series[0];
  const last = series[series.length - 1];
  const change = first && last
    ? {
        from: first.day,
        to: last.day,
        tvlUsd: last.totalTvlUsd - first.totalTvlUsd,
        apyPercentagePoints:
          first.tvlWeightedApyPercent != null && last.tvlWeightedApyPercent != null
            ? round2(last.tvlWeightedApyPercent - first.tvlWeightedApyPercent)
            : null,
      }
    : null;
  return {
    symbol: s,
    chain: chain ?? null,
    days: series.length,
    series,
    change,
    note: series.length ? undefined : 'No snapshots yet for this symbol.',
    disclaimer: DISCLAIMER,
  };
}

// Alerts: evaluate stored rules against the current market.
// alert: { id, symbol|null, chain|null, metric: 'apy'|'tvl', operator: 'above'|'below', threshold, minTvlUsd? }
// Returns one entry per triggered alert with the deployments that satisfied it.
export function evaluateAlerts(market, alerts) {
  const out = [];
  for (const alert of alerts) {
    const sym = alert.symbol ? String(alert.symbol).toUpperCase() : null;
    const floor = alert.minTvlUsd ?? 1_000_000;
    const matches = market.assets.filter((a) => {
      if (sym ? a.symbol !== sym : a.kind !== 'treasury') return false;
      if (alert.chain && a.chain.toLowerCase() !== String(alert.chain).toLowerCase()) return false;
      if (a.tvlUsd < floor) return false;
      const value = alert.metric === 'tvl' ? a.tvlUsd : a.apyPercent;
      if (value == null) return false;
      return alert.operator === 'above' ? value > alert.threshold : value < alert.threshold;
    });
    if (matches.length) out.push({ alert, matches });
  }
  return out;
}

// Changes between an older snapshot and the latest market, per deployment, biggest movers first.
export function marketChanges(latest, older, { kind = 'treasury', minTvlUsd = 1_000_000, limit = 15 } = {}) {
  const key = (a) => `${a.symbol}|${a.chain}|${a.project}`;
  const before = new Map(older.assets.map((a) => [key(a), a]));
  const rows = [];
  for (const a of latest.assets) {
    if (kind && a.kind !== kind) continue;
    if (a.tvlUsd < minTvlUsd) continue;
    const b = before.get(key(a));
    if (!b) { rows.push({ symbol: a.symbol, chain: a.chain, project: a.project, status: 'new', apyPercent: a.apyPercent, tvlUsd: a.tvlUsd }); continue; }
    rows.push({
      symbol: a.symbol, chain: a.chain, project: a.project, status: 'changed',
      apyPercent: a.apyPercent, apyChangePoints: a.apyPercent != null && b.apyPercent != null ? round2(a.apyPercent - b.apyPercent) : null,
      tvlUsd: a.tvlUsd, tvlChangeUsd: a.tvlUsd - b.tvlUsd, tvlChangePercent: b.tvlUsd ? round2(((a.tvlUsd - b.tvlUsd) / b.tvlUsd) * 100) : null,
    });
  }
  const seen = new Set(latest.assets.map(key));
  for (const b of older.assets) {
    if ((kind && b.kind !== kind) || b.tvlUsd < minTvlUsd || seen.has(key(b))) continue;
    rows.push({ symbol: b.symbol, chain: b.chain, project: b.project, status: 'gone', apyPercent: null, tvlUsd: 0, tvlChangeUsd: -b.tvlUsd });
  }
  rows.sort((x, y) => Math.abs(y.tvlChangeUsd ?? y.tvlUsd ?? 0) - Math.abs(x.tvlChangeUsd ?? x.tvlUsd ?? 0));
  const sum = (m, f) => m.assets.filter((a) => (!kind || a.kind === kind)).reduce((s, a) => s + f(a), 0);
  return {
    from: older.fetchedAt, to: latest.fetchedAt,
    totalTvlUsd: { before: sum(older, (a) => a.tvlUsd), after: sum(latest, (a) => a.tvlUsd) },
    movers: rows.slice(0, limit),
    disclaimer: DISCLAIMER,
  };
}
