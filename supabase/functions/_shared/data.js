// Data layer.
// Fetches public DefiLlama data, keeps only pools that belong to protocols DefiLlama
// classifies as "RWA" (real-world assets), normalizes them into a small shape that is
// easy for an AI agent to read, and caches the result for ten minutes.
//
// No API key is needed. Nothing here moves money or talks to a wallet.

export const POOLS_URL = 'https://yields.llama.fi/pools';
export const PROTOCOLS_URL = 'https://api.llama.fi/protocols';
export const CACHE_TTL_MS = 10 * 60 * 1000;

// Hand-curated metadata. `kind` drives filtering ("treasury" = tokenized US government
// debt / money-market style products). Descriptions are intentionally generic.
// Always confirm details against the issuer's own documents before relying on them.
export const KNOWN_ASSETS = {
  BUIDL: { kind: 'treasury', description: 'Tokenized institutional fund holding cash, US Treasuries and repo' },
  OUSG:  { kind: 'treasury', description: 'Tokenized exposure to short-term US Treasuries' },
  USDY:  { kind: 'treasury', description: 'Yield-bearing token backed by short-term US Treasuries and bank deposits' },
  USYC:  { kind: 'treasury', description: 'Tokenized money-market style fund of short-term US government securities' },
  USTB:  { kind: 'treasury', description: 'Tokenized short-duration US government securities fund' },
  TBILL: { kind: 'treasury', description: 'Tokenized short-term US Treasury bills' },
  STBT:  { kind: 'treasury', description: 'Tokenized short-term US Treasury bills and repo' },
  BENJI: { kind: 'treasury', description: 'Tokenized US government money market fund' },
  USCC:  { kind: 'other_rwa', description: 'Tokenized fund; not a treasury product (verify strategy with issuer)' },
};

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function normalizePool(p) {
  const symbol = String(p.symbol ?? '').toUpperCase();
  const known = KNOWN_ASSETS[symbol];
  return {
    symbol,
    project: p.project,
    chain: p.chain,
    kind: known?.kind ?? 'other_rwa',
    description: known?.description ?? null,
    apyPercent: num(p.apy),
    apyMean30dPercent: num(p.apyMean30d),
    tvlUsd: Math.round(num(p.tvlUsd) ?? 0),
    stablecoin: Boolean(p.stablecoin),
    poolId: p.pool,
  };
}

// Pure function: raw DefiLlama JSON in, normalized market out. Easy to test.
export function buildMarket(poolsJson, protocolsJson, fetchedAt = new Date().toISOString()) {
  const rwaProjects = new Set(
    (protocolsJson ?? [])
      .filter((p) => String(p.category ?? '').toLowerCase() === 'rwa')
      .map((p) => p.slug),
  );
  const assets = (poolsJson?.data ?? [])
    .filter((p) => rwaProjects.has(p.project))
    .map(normalizePool);
  return {
    fetchedAt,
    source: 'DefiLlama (yields.llama.fi, api.llama.fi)',
    assets,
  };
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Upstream ${url} responded ${res.status}`);
  return res.json();
}

let cache = { at: 0, market: null };

export async function loadMarket({ fetchImpl = globalThis.fetch, now = Date.now, force = false } = {}) {
  if (!force && cache.market && now() - cache.at < CACHE_TTL_MS) return cache.market;
  const [pools, protocols] = await Promise.all([
    getJson(fetchImpl, POOLS_URL),
    getJson(fetchImpl, PROTOCOLS_URL),
  ]);
  const market = buildMarket(pools, protocols);
  cache = { at: now(), market };
  return market;
}

// Local snapshot store for development: one JSON file per UTC day in a directory.
// The hosted version uses Postgres instead (see supabase/functions/refresh).
export function fileHistory(dir, fsPromises) {
  return {
    async load(days = 30) {
      let names = [];
      try { names = await fsPromises.readdir(dir); } catch { return []; }
      const files = names.filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().slice(-days);
      const out = [];
      for (const f of files) {
        const market = JSON.parse(await fsPromises.readFile(`${dir}/${f}`, 'utf8'));
        out.push({ day: f.slice(0, 10), assets: market.assets });
      }
      return out;
    },
    async save(market) {
      await fsPromises.mkdir(dir, { recursive: true });
      const day = market.fetchedAt.slice(0, 10);
      await fsPromises.writeFile(`${dir}/${day}.json`, JSON.stringify(market));
      return day;
    },
  };
}
