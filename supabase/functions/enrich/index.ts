// Fills equity_meta (chains, homepage) from CoinGecko's per-coin endpoint, a few tokens per run, oldest first.
// Called every 10 minutes by pg_cron; guarded by the REFRESH_SECRET header.
import { createClient } from '@supabase/supabase-js';

const BATCH = 6;   // keyless CoinGecko tolerates only a handful of calls per minute from cloud IPs; raise once COINGECKO_API_KEY is set
const STALE_DAYS = 7;

Deno.serve(async (req) => {
  const secret = Deno.env.get('REFRESH_SECRET');
  if (!secret || req.headers.get('x-refresh-secret') !== secret) return new Response('unauthorized', { status: 401 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: latest } = await db.from('market_latest').select('data').eq('id', 1).maybeSingle();
  const equities: { coingeckoId: string; marketCapUsd: number }[] = latest?.data?.equities ?? [];
  const { data: metaRows } = await db.from('equity_meta').select('coingecko_id,updated_at');
  const updated = new Map((metaRows ?? []).map((r) => [r.coingecko_id, new Date(r.updated_at).getTime()]));
  const cutoff = Date.now() - STALE_DAYS * 86400_000;
  const todo = equities.filter((e) => !updated.has(e.coingeckoId) || updated.get(e.coingeckoId)! < cutoff).slice(0, BATCH);
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = Deno.env.get('COINGECKO_API_KEY'); if (key) headers['x-cg-demo-api-key'] = key;
  let done = 0; let rateLimited = false;
  for (const e of todo) {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${e.coingeckoId}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`, { headers });
    if (r.status === 429) { rateLimited = true; break; }
    if (!r.ok) continue;
    const j = await r.json();
    const chains = Object.keys(j.platforms ?? {}).filter(Boolean);
    await db.from('equity_meta').upsert({ coingecko_id: e.coingeckoId, chains, homepage: j.links?.homepage?.[0] ?? null, updated_at: new Date().toISOString() });
    done += 1;
    await new Promise((res) => setTimeout(res, key ? 1500 : 7000));
  }
  return Response.json({ ok: true, candidates: todo.length, enriched: done, rateLimited, remaining: equities.length - updated.size });
});
