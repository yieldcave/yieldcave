// Tool logic. Every function here is pure: it takes a `market` object (see data.js)
// plus arguments and returns plain JSON. The MCP server in server.js is a thin wrapper.
//
// Design rule: these tools return data and arithmetic. They never recommend.

import { termsSummary } from './issuers.js';

export const DISCLAIMER =
  'Information only, not financial advice. Figures come from public third-party data and may be delayed or wrong. Verify with the issuer before acting.';

const byDesc = (key) => (a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity);
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

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
export function historySeries(snapshots, { symbol, chain, days = 30, universe = 'rwa' } = {}) {
  const s = String(symbol ?? '').toUpperCase();
  const field = universe === 'stablecoin' ? 'stables' : 'assets';
  const series = [...snapshots]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .slice(-days)
    .map((snap) => {
      const m = (snap[field] ?? []).filter((a) => a.symbol === s && (!chain || a.chain.toLowerCase() === chain.toLowerCase()));
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
    universe,
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
    const stable = alert.universe === 'stablecoin';
    const pool = stable ? (market.stables ?? []) : market.assets;
    const matches = pool.filter((a) => {
      if (stable ? (sym ? a.symbol !== sym : !a.major) : (sym ? a.symbol !== sym : a.kind !== 'treasury')) return false;
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
export function marketChanges(latest, older, { kind = 'treasury', minTvlUsd = 1_000_000, limit = 15, universe = 'rwa' } = {}) {
  const key = (a) => `${a.symbol}|${a.chain}|${a.project}`;
  const field = universe === 'stablecoin' ? 'stables' : 'assets';
  if (universe === 'stablecoin') { kind = null; minTvlUsd = Math.max(minTvlUsd, 10_000_000); }
  const before = new Map((older[field] ?? []).map((a) => [key(a), a]));
  const rows = [];
  for (const a of latest[field] ?? []) {
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
  const seen = new Set((latest[field] ?? []).map(key));
  for (const b of older[field] ?? []) {
    if ((kind && b.kind !== kind) || b.tvlUsd < minTvlUsd || seen.has(key(b))) continue;
    rows.push({ symbol: b.symbol, chain: b.chain, project: b.project, status: 'gone', apyPercent: null, tvlUsd: 0, tvlChangeUsd: -b.tvlUsd });
  }
  rows.sort((x, y) => Math.abs(y.tvlChangeUsd ?? y.tvlUsd ?? 0) - Math.abs(x.tvlChangeUsd ?? x.tvlUsd ?? 0));
  const sum = (m, f) => (m[field] ?? []).filter((a) => (!kind || a.kind === kind) && a.tvlUsd >= minTvlUsd).reduce((s, a) => s + f(a), 0);
  return {
    universe, from: older.fetchedAt, to: latest.fetchedAt,
    totalTvlUsd: { before: sum(older, (a) => a.tvlUsd), after: sum(latest, (a) => a.tvlUsd) },
    movers: rows.slice(0, limit),
    disclaimer: DISCLAIMER,
  };
}

// ---------- Stablecoin universe ----------
export const STABLE_GROUPS = {
  lending: 'Collateralized lending markets and CDPs (e.g. Aave, Morpho, Sky). Borrowers post collateral.',
  vault: 'Vaults and curated allocators that route deposits across venues. Adds a manager and smart-contract layer.',
  credit: 'Uncollateralized or private credit. Yield depends on borrowers repaying; higher rates, higher risk.',
  basis: 'Basis and funding-rate trades or synthetic dollars. Yield depends on derivatives markets and can turn negative.',
  other: 'Uncategorized by DefiLlama.',
};

export function listStables(market, { symbol, chain, group, minTvlUsd = 10_000_000, limit = 20, sortBy = 'apy', majorOnly = false } = {}) {
  let rows = (market.stables ?? []).filter((a) => a.tvlUsd >= minTvlUsd);
  if (symbol) rows = rows.filter((a) => a.symbol === String(symbol).toUpperCase());
  if (chain) rows = rows.filter((a) => a.chain.toLowerCase() === String(chain).toLowerCase());
  if (group) rows = rows.filter((a) => a.group === group);
  if (majorOnly) rows = rows.filter((a) => a.major);
  rows = [...rows].sort(byDesc(sortBy === 'tvlUsd' ? 'tvlUsd' : 'apyPercent'));
  return {
    fetchedAt: market.fetchedAt, source: market.source, matched: rows.length,
    pools: rows.slice(0, limit), groups: STABLE_GROUPS,
    note: 'apyPercent = apyBasePercent + apyRewardPercent. Reward yield is paid in a protocol token and can change or stop. Compare apyMean30dPercent to spot short-lived spikes.',
    disclaimer: DISCLAIMER,
  };
}

export function stablecoinSummary(market, { minTvlUsd = 10_000_000 } = {}) {
  const pools = (market.stables ?? []).filter((a) => a.tvlUsd >= minTvlUsd && a.apyPercent != null);
  const bySymbol = new Map();
  for (const a of pools) {
    const cur = bySymbol.get(a.symbol) ?? { symbol: a.symbol, major: a.major, venues: 0, totalTvlUsd: 0, apys: [], best: null, bestLending: null };
    cur.venues += 1; cur.totalTvlUsd += a.tvlUsd; cur.apys.push(a.apyPercent);
    if (!cur.best || a.apyPercent > cur.best.apyPercent) cur.best = a;
    if (a.group === 'lending' && (!cur.bestLending || a.apyPercent > cur.bestLending.apyPercent)) cur.bestLending = a;
    bySymbol.set(a.symbol, cur);
  }
  const pick = (a) => a && { project: a.project, chain: a.chain, group: a.group, apyPercent: a.apyPercent, apyMean30dPercent: a.apyMean30dPercent, tvlUsd: a.tvlUsd };
  const stablecoins = [...bySymbol.values()].sort(byDesc('totalTvlUsd')).map((c) => ({
    symbol: c.symbol, major: c.major, venues: c.venues, totalTvlUsd: c.totalTvlUsd, medianApyPercent: round2(median(c.apys)),
    bestAnyGroup: pick(c.best), bestLending: pick(c.bestLending),
  }));
  const byGroup = {};
  for (const a of pools) { const g = (byGroup[a.group] ??= { pools: 0, tvlUsd: 0, apys: [] }); g.pools += 1; g.tvlUsd += a.tvlUsd; g.apys.push(a.apyPercent); }
  for (const g of Object.values(byGroup)) { g.medianApyPercent = round2(median(g.apys)); delete g.apys; }
  const treasuries = market.assets.filter((a) => a.kind === 'treasury' && a.tvlUsd >= minTvlUsd).map((a) => a.apyPercent);
  return {
    fetchedAt: market.fetchedAt, source: market.source, minTvlUsd,
    totals: { pools: pools.length, tvlUsd: pools.reduce((s, a) => s + a.tvlUsd, 0), medianApyPercent: round2(median(pools.map((a) => a.apyPercent))) },
    byGroup, stablecoins: stablecoins.slice(0, 15),
    tokenizedTreasuryMedianApyPercent: round2(median(treasuries)),
    groups: STABLE_GROUPS, disclaimer: DISCLAIMER,
  };
}
