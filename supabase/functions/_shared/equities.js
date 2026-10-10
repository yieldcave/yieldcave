// Tokenized equities: stocks, pre-IPO shares and ETFs wrapped as onchain tokens.
// Source: CoinGecko categories (tokenized-stock, tokenized-pre-ipo-stocks, tokenized-exchange-traded-funds-etfs),
// optional underlying quotes for a premium/discount figure, and per-token chain metadata gathered separately.

export const CG = 'https://api.coingecko.com/api/v3';
export const EQUITY_CATEGORIES = { stock: 'tokenized-stock', 'pre-ipo': 'tokenized-pre-ipo-stocks', etf: 'tokenized-exchange-traded-funds-etfs' };

// Issuer detection from CoinGecko names; `strip` removes the issuer suffix from the symbol to get the underlying ticker.
const ISSUERS = [
  { issuer: 'xStocks (Backed)', test: (n) => /xstock/i.test(n), strip: (s) => s.replace(/x$/i, '') },
  { issuer: 'bStocks', test: (n) => /bstocks?/i.test(n), strip: (s) => s.replace(/b$/i, '') },
  { issuer: 'Ondo Global Markets', test: (n) => /ondo/i.test(n), strip: (s) => s.replace(/on$/i, '') },
  { issuer: 'Robinhood', test: (n) => /robinhood/i.test(n), strip: (s) => s },
  { issuer: 'Dinari', test: (n) => /dinari|dshare/i.test(n), strip: (s) => s.replace(/\.d$|d$/i, '') },
  { issuer: 'Coinbase', test: (n) => /coinbase tokenized/i.test(n), strip: (s) => s },
  { issuer: 'Backpack', test: (n) => /backpack/i.test(n), strip: (s) => s },
  { issuer: 'Remora Markets', test: (n) => /remora|rstock/i.test(n), strip: (s) => s.replace(/r$/i, '') },
  { issuer: 'OpenStock', test: (n) => /openstock/i.test(n), strip: (s) => s },
  { issuer: 'PreStocks', test: (n) => /prestock/i.test(n), strip: (s) => s },
  { issuer: 'Republic', test: (n) => /republic/i.test(n), strip: (s) => s },
  { issuer: 'Tessera', test: (n) => /tessera/i.test(n), strip: (s) => s },
];

export function parseEquity(row, kind) {
  const name = row.name ?? '';
  const sym = String(row.symbol ?? '').toUpperCase();
  const rule = ISSUERS.find((r) => r.test(name));
  const underlying = rule ? rule.strip(sym).toUpperCase() : null;
  return {
    symbol: sym,
    name,
    coingeckoId: row.id,
    issuer: rule?.issuer ?? 'other',
    kind,
    underlying: underlying && underlying !== sym ? underlying : (rule ? underlying : null),
    priceUsd: num(row.current_price),
    marketCapUsd: Math.round(num(row.market_cap) ?? 0),
    volume24hUsd: Math.round(num(row.total_volume) ?? 0),
    change24hPercent: round2(num(row.price_change_percentage_24h)),
    underlyingPriceUsd: null,
    premiumPercent: null,
    underlyingAsOf: null,
    chains: [],
  };
}

// pagesByKind: { stock: [page1Rows, page2Rows, ...], 'pre-ipo': [...], etf: [...] }
export function buildEquities(pagesByKind, { quotes = {}, meta = {} } = {}) {
  const out = [];
  const seen = new Set();
  for (const [kind, pages] of Object.entries(pagesByKind)) {
    for (const rows of pages ?? []) {
      for (const row of rows ?? []) {
        if (!row?.id || seen.has(row.id)) continue;
        seen.add(row.id);
        const e = parseEquity(row, kind);
        const q = e.underlying ? quotes[e.underlying] : null;
        if (q?.price && e.priceUsd) {
          e.underlyingPriceUsd = q.price;
          e.premiumPercent = round2(((e.priceUsd - q.price) / q.price) * 100);
          e.underlyingAsOf = q.asOf ?? null;
        }
        const m = meta[row.id];
        if (m?.chains) e.chains = m.chains;
        out.push(e);
      }
    }
  }
  return out.sort((a, b) => b.marketCapUsd - a.marketCapUsd);
}

export function listEquities(market, { issuer, kind, underlying, chain, minMarketCapUsd = 1_000_000, sortBy = 'marketCap', limit = 20 } = {}) {
  let rows = (market.equities ?? []).filter((e) => e.marketCapUsd >= minMarketCapUsd);
  if (issuer) rows = rows.filter((e) => e.issuer.toLowerCase().includes(String(issuer).toLowerCase()));
  if (kind) rows = rows.filter((e) => e.kind === kind);
  if (underlying) rows = rows.filter((e) => e.underlying === String(underlying).toUpperCase());
  if (chain) rows = rows.filter((e) => e.chains.some((c) => c.toLowerCase() === String(chain).toLowerCase()));
  const key = sortBy === 'volume' ? 'volume24hUsd' : sortBy === 'premium' ? 'premiumPercent' : 'marketCapUsd';
  const val = (e) => (e[key] == null ? -1 : Math.abs(e[key]));
  rows = [...rows].sort((a, b) => val(b) - val(a));
  return {
    fetchedAt: market.fetchedAt, source: 'CoinGecko (tokenized stock, pre-IPO and ETF categories); underlying quotes via Yahoo Finance chart data, delayed',
    matched: rows.length, equities: rows.slice(0, limit),
    note: 'premiumPercent compares the token price to the latest underlying quote; both move, quotes are delayed, and tokens trade when the stock market is closed, so a premium can simply mean after-hours news. Chains are filled in gradually from CoinGecko metadata.',
    disclaimer: DISCLAIMER,
  };
}

export function getEquity(market, underlying) {
  const u = String(underlying ?? '').toUpperCase();
  const rows = (market.equities ?? []).filter((e) => e.underlying === u).sort((a, b) => b.marketCapUsd - a.marketCapUsd);
  if (!rows.length) return { underlying: u, found: false, hint: 'Try list_tokenized_equities, or a symbol like TSLA, NVDA, CRCL.', disclaimer: DISCLAIMER };
  const withPremium = rows.filter((e) => e.premiumPercent != null);
  return {
    fetchedAt: market.fetchedAt, underlying: u, found: true,
    wrappers: rows.length, issuers: [...new Set(rows.map((e) => e.issuer))], chains: [...new Set(rows.flatMap((e) => e.chains))],
    totalMarketCapUsd: rows.reduce((s, e) => s + e.marketCapUsd, 0), totalVolume24hUsd: rows.reduce((s, e) => s + e.volume24hUsd, 0),
    underlyingPriceUsd: withPremium[0]?.underlyingPriceUsd ?? null,
    premiumRangePercent: withPremium.length ? { min: Math.min(...withPremium.map((e) => e.premiumPercent)), max: Math.max(...withPremium.map((e) => e.premiumPercent)) } : null,
    mostLiquid: rows.slice().sort((a, b) => b.volume24hUsd - a.volume24hUsd)[0]?.symbol ?? null,
    tokens: rows, disclaimer: DISCLAIMER,
  };
}

export function equitySummary(market) {
  const rows = market.equities ?? [];
  const by = (f) => { const m = {}; for (const e of rows) { const k = f(e); const g = (m[k] ??= { tokens: 0, marketCapUsd: 0, volume24hUsd: 0 }); g.tokens += 1; g.marketCapUsd += e.marketCapUsd; g.volume24hUsd += e.volume24hUsd; } return m; };
  const byUnderlying = {};
  for (const e of rows) { if (!e.underlying) continue; const g = (byUnderlying[e.underlying] ??= { underlying: e.underlying, wrappers: 0, marketCapUsd: 0, volume24hUsd: 0, issuers: new Set() }); g.wrappers += 1; g.marketCapUsd += e.marketCapUsd; g.volume24hUsd += e.volume24hUsd; g.issuers.add(e.issuer); }
  const top = Object.values(byUnderlying).sort((a, b) => b.marketCapUsd - a.marketCapUsd).slice(0, 10).map((g) => ({ ...g, issuers: [...g.issuers] }));
  const prem = rows.filter((e) => e.premiumPercent != null).map((e) => Math.abs(e.premiumPercent));
  return {
    fetchedAt: market.fetchedAt,
    totals: { tokens: rows.length, marketCapUsd: rows.reduce((s, e) => s + e.marketCapUsd, 0), volume24hUsd: rows.reduce((s, e) => s + e.volume24hUsd, 0) },
    byIssuer: by((e) => e.issuer), byKind: by((e) => e.kind),
    topUnderlyings: top,
    premium: { tokensWithQuote: prem.length, medianAbsPremiumPercent: round2(median(prem)) },
    disclaimer: DISCLAIMER,
  };
}

const DISCLAIMER = 'Information only, not financial advice. Figures come from public third-party data and may be delayed or wrong. Tokenized equities carry issuer, custody, liquidity and regulatory risk beyond the underlying stock.';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
function median(values) { const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
