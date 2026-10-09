// Fetches DefiLlama, stores the normalized market in `market_latest` and today's snapshot in `snapshots`.
// Called hourly by pg_cron (see migrations) and guarded by the REFRESH_SECRET header.
import { createClient } from '@supabase/supabase-js';
import { buildMarket, POOLS_URL, PROTOCOLS_URL } from '../_shared/data.js';
import { evaluateAlerts, DISCLAIMER } from '../_shared/tools.js';

Deno.serve(async (req) => {
  const secret = Deno.env.get('REFRESH_SECRET');
  if (!secret || req.headers.get('x-refresh-secret') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }
  const [pools, protocols] = await Promise.all([
    fetch(POOLS_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`pools ${r.status}`)))),
    fetch(PROTOCOLS_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`protocols ${r.status}`)))),
  ]);
  const market = buildMarket(pools, protocols);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const day = market.fetchedAt.slice(0, 10);
  const row = { fetched_at: market.fetchedAt, data: market };
  const a = await db.from('market_latest').upsert({ id: 1, ...row });
  if (a.error) return Response.json({ ok: false, error: a.error.message }, { status: 500 });
  const b = await db.from('snapshots').upsert({ day, ...row });
  if (b.error) return Response.json({ ok: false, error: b.error.message }, { status: 500 });
  // Alerts: fire webhooks for rules that are satisfied and have not fired in the last 24 hours.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: rules } = await db.from('alerts').select('*').eq('active', true).or(`last_fired_at.is.null,last_fired_at.lt.${since}`);
  const triggered = evaluateAlerts(market, (rules ?? []).map((r) => ({ ...r, threshold: Number(r.threshold), minTvlUsd: r.universe === 'stablecoin' ? 10_000_000 : undefined })));
  let fired = 0;
  for (const { alert, matches } of triggered) {
    const payload = {
      source: 'yieldcave', alertId: alert.id, label: alert.label, universe: alert.universe ?? 'rwa', symbol: alert.symbol, chain: alert.chain,
      metric: alert.metric, operator: alert.operator, threshold: alert.threshold,
      matches: matches.map((m) => ({ symbol: m.symbol, chain: m.chain, project: m.project, apyPercent: m.apyPercent, tvlUsd: m.tvlUsd })),
      fetchedAt: market.fetchedAt, disclaimer: DISCLAIMER,
      // Slack/Discord-friendly text
      text: `YieldCave alert${alert.label ? ` (${alert.label})` : ''}: ${alert.metric} ${alert.operator} ${alert.threshold} for ` +
        matches.slice(0, 5).map((m) => `${m.symbol} on ${m.chain} (${m.apyPercent?.toFixed(2)}%, $${Math.round(m.tvlUsd).toLocaleString('en-US')})`).join('; '),
      content: undefined as string | undefined,
    };
    payload.content = payload.text;
    try {
      const r = await fetch(alert.webhook_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
      if (r.ok || r.status === 204) { fired += 1; await db.from('alerts').update({ last_fired_at: market.fetchedAt }).eq('id', alert.id); }
    } catch (_) { /* webhook unreachable: try again next hour */ }
  }
  return Response.json({ ok: true, day, fetchedAt: market.fetchedAt, assets: market.assets.length, alertsChecked: (rules ?? []).length, alertsFired: fired });
});
