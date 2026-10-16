// Fills equity_meta (chains, homepage) from CoinGecko's per-coin endpoint, a few tokens per run, oldest first.
// Called every 10 minutes by pg_cron; guarded by the REFRESH_SECRET header.
import { createClient } from '@supabase/supabase-js';

const STALE_DAYS = 30;   // chain metadata rarely changes; keeps enrich well inside the 10k/month Demo allowance

Deno.serve(async (req) => {
  const secret = Deno.env.get('REFRESH_SECRET');
  if (!secret || req.headers.get('x-refresh-secret') !== secret) return new Response('unauthorized', { status: 401 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: latest } = await db.from('market_latest').select('data').eq('id', 1).maybeSingle();
  const equities: { coingeckoId: string; marketCapUsd: number }[] = latest?.data?.equities ?? [];
  const { data: metaRows } = await db.from('equity_meta').select('coingecko_id,updated_at');
  const updated = new Map((metaRows ?? []).map((r) => [r.coingecko_id, new Date(r.updated_at).getTime()]));
  const cutoff = Date.now() - STALE_DAYS * 86400_000;
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = Deno.env.get('COINGECKO_API_KEY'); if (key) headers['x-cg-demo-api-key'] = key;
  const BATCH = key ? 25 : 6;   // Demo plan allows ~30 calls/min; keyless cloud access tolerates only a few
  const todo = equities.filter((e) => !updated.has(e.coingeckoId) || updated.get(e.coingeckoId)! < cutoff).slice(0, BATCH);
  let done = 0; let rateLimited = false;
  for (const e of todo) {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${e.coingeckoId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`, { headers });
    if (r.status === 429 || r.status === 401 || r.status === 403) { rateLimited = true; break; }
    if (!r.ok) {
      // Record the miss so a coin CoinGecko can't serve is not retried every 10 minutes (each retry costs a credit).
      await db.from('equity_meta').upsert({ coingecko_id: e.coingeckoId, chains: [], homepage: null, updated_at: new Date().toISOString() });
      continue;
    }
    const j = await r.json();
    const chains = Object.keys(j.platforms ?? {}).filter(Boolean);
    await db.from('equity_meta').upsert({ coingecko_id: e.coingeckoId, chains, homepage: j.links?.homepage?.[0] ?? null, updated_at: new Date().toISOString() });
    done += 1;
    await new Promise((res) => setTimeout(res, key ? 1500 : 7000));
  }
  return Response.json({ ok: true, candidates: todo.length, enriched: done, rateLimited, remaining: equities.length - updated.size });
});
