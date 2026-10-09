// Public MCP endpoint. Reads the market from Postgres (kept fresh by `refresh`), meters usage per API key or IP,
// scopes alerts to the caller's key, and exposes account tools (create_api_key, my_usage, upgrade).
// URL: https://<project-ref>.supabase.co/functions/v1/mcp
import { createClient } from '@supabase/supabase-js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createServer } from '../_shared/mcp.js';
import { PLANS, allowance, alertAllowance, limitMessage, KEY_TOOLS } from '../_shared/plans.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const VERSION = '0.7.0';

const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join('');
const today = () => new Date().toISOString().slice(0, 10);
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString().replace('.000Z', 'Z'); };

type Caller = { tier: 'anonymous' | 'free' | 'pro'; subject: string; keyId: string | null; email: string | null; stripeCustomerId: string | null };

async function identify(req: Request): Promise<Caller> {
  // Key sources, in order of precedence: x-api-key header, Authorization: Bearer, then ?key= in the URL
  // (claude.ai custom connectors cannot send headers). The key and the query string are never logged.
  const auth = req.headers.get('authorization') ?? '';
  const headerKey = req.headers.get('x-api-key') ?? (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '');
  const key = headerKey || (new URL(req.url).searchParams.get('key') ?? '').trim();
  if (key.startsWith('yc_') || key.startsWith('ep_')) {
    const { data } = await db.from('api_keys').select('id,tier,email,revoked_at,stripe_customer_id').eq('key_hash', await sha256(key)).maybeSingle();
    if (data && !data.revoked_at) return { tier: data.tier, subject: `key:${data.id}`, keyId: data.id, email: data.email, stripeCustomerId: data.stripe_customer_id ?? null };
  }
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  return { tier: 'anonymous', subject: `ip:${(await sha256(ip + SUPABASE_URL)).slice(0, 24)}`, keyId: null, email: null, stripeCustomerId: null };
}

async function callsToday(subject: string) {
  const { data } = await db.from('usage_daily').select('calls').eq('day', today()).eq('subject', subject);
  return (data ?? []).reduce((s, r) => s + r.calls, 0);
}
async function activeAlerts(keyId: string | null) {
  if (!keyId) return 0;
  const { count } = await db.from('alerts').select('id', { count: 'exact', head: true }).eq('active', true).eq('key_id', keyId);
  return count ?? 0;
}

async function loadMarket() {
  const { data, error } = await db.from('market_latest').select('data').eq('id', 1).maybeSingle();
  if (error) throw new Error(`database: ${error.message}`);
  if (!data) throw new Error('Market data not loaded yet. The refresh job has not run.');
  return data.data;
}
const history = {
  async load(days: number) {
    const { data, error } = await db.from('snapshots').select('day,data').order('day', { ascending: false }).limit(days);
    if (error) throw new Error(`database: ${error.message}`);
    return (data ?? []).map((r) => ({ day: r.day, assets: r.data.assets, stables: r.data.stables ?? [] }));
  },
};
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return 'invalid'; } };

function alertsFor(caller: Caller) {
  return {
    async create(a: { metric: string; operator: string; threshold: number; webhookUrl: string; symbol?: string; chain?: string; label?: string; universe?: string }) {
      if (!caller.keyId) throw new Error(limitMessage('alerts', 'anonymous'));
      const used = await activeAlerts(caller.keyId);
      const allow = alertAllowance(caller.tier, used);
      if (!allow.allowed) throw new Error(limitMessage('alerts', caller.tier));
      const { data, error } = await db.from('alerts').insert({
        key_id: caller.keyId, metric: a.metric, operator: a.operator, threshold: a.threshold, webhook_url: a.webhookUrl,
        symbol: a.symbol?.toUpperCase() ?? null, chain: a.chain ?? null, label: a.label ?? null, universe: a.universe ?? 'rwa',
      }).select('id,created_at,universe,symbol,chain,metric,operator,threshold,label').single();
      if (error) throw new Error(`database: ${error.message}`);
      return { ...data, webhookHost: hostOf(a.webhookUrl), checkedEvery: '1 hour', firesAtMost: 'once per 24 hours', alertsUsed: used + 1, alertsLimit: allow.limit };
    },
    async list() {
      if (!caller.keyId) return [];
      const { data, error } = await db.from('alerts').select('id,created_at,universe,symbol,chain,metric,operator,threshold,label,webhook_url,last_fired_at').eq('active', true).eq('key_id', caller.keyId).order('created_at');
      if (error) throw new Error(`database: ${error.message}`);
      return (data ?? []).map(({ webhook_url, ...r }) => ({ ...r, webhookHost: hostOf(webhook_url) }));
    },
    async remove(id: string) {
      if (!caller.keyId) return false;
      const { data, error } = await db.from('alerts').delete().eq('id', id).eq('key_id', caller.keyId).select('id');
      if (error) throw new Error(`database: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}

function accountFor(caller: Caller) {
  return {
    async usage() {
      const [calls, alerts] = await Promise.all([callsToday(caller.subject), activeAlerts(caller.keyId)]);
      return { plan: PLANS[caller.tier].name, email: caller.email, calls: allowance(caller.tier, calls), alerts: alertAllowance(caller.tier, alerts), resetsAt: nextUtcMidnight() };
    },
    async createKey(email: string) {
      const existing = await db.from('api_keys').select('id,prefix,tier').eq('email', email.toLowerCase()).maybeSingle();
      if (existing.data) return { created: false, note: `A key for ${email} already exists (prefix ${existing.data.prefix}). Keys are shown once; email support if you lost it.`, tier: existing.data.tier };
      const raw = 'yc_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, 'a').replace(/\//g, 'b').replace(/=+$/, '');
      const { data, error } = await db.from('api_keys').insert({ key_hash: await sha256(raw), prefix: raw.slice(0, 10), email: email.toLowerCase() }).select('id,tier,created_at').single();
      if (error) throw new Error(`database: ${error.message}`);
      return { created: true, apiKey: raw, keyId: data.id, tier: data.tier, limits: PLANS.free, howToUse: 'Send the key as an x-api-key header (or Authorization: Bearer <key>). In claude.ai, which cannot send headers, put it in the connector URL instead: https://ccvhvxbqtvqbhexhrjnj.supabase.co/functions/v1/mcp?key=<key>', shownOnce: true };
    },
    async checkout() {
      if (!caller.keyId) return { url: null, note: limitMessage('alerts', 'anonymous').replace('Alerts need', 'Upgrading needs') };
      if (caller.tier === 'pro') return { url: null, note: 'You are already on Pro.' };
      const sk = Deno.env.get('STRIPE_SECRET_KEY'); const price = Deno.env.get('STRIPE_PRICE_ID');
      if (!sk || !price) return { url: null, note: 'Payments are not switched on yet. Pro is not purchasable until then.', plan: PLANS.pro };
      const site = Deno.env.get('SITE_URL') ?? 'https://yieldcave.com';
      const form = new URLSearchParams({
        mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1', client_reference_id: caller.keyId,
        customer_email: caller.email ?? '', success_url: `${site}/thanks`, cancel_url: `${site}/`, allow_promotion_codes: 'true',
      });
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Basic ${btoa(sk + ':')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form });
      const j = await r.json();
      if (!r.ok) return { url: null, note: `Stripe error: ${j.error?.message ?? r.status}` };
      return { url: j.url, plan: PLANS.pro, note: 'Open the link to pay. Your key is upgraded automatically when payment completes.' };
    },
    async portal() {
      if (!caller.keyId) return { url: null, note: 'manage_subscription needs an API key.' };
      if (!caller.stripeCustomerId) return { url: null, note: caller.tier === 'pro' ? 'No Stripe customer is linked to this key. Contact support.' : 'This key has no subscription yet. Call upgrade to start one.' };
      const sk = Deno.env.get('STRIPE_SECRET_KEY');
      if (!sk) return { url: null, note: 'Payments are not switched on yet.' };
      const form = new URLSearchParams({ customer: caller.stripeCustomerId, return_url: Deno.env.get('SITE_URL') ?? 'https://yieldcave.com' });
      const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', { method: 'POST', headers: { authorization: `Basic ${btoa(sk + ':')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form });
      const j = await r.json();
      if (!r.ok) return { url: null, note: `Stripe error: ${j.error?.message ?? r.status}` };
      return { url: j.url, note: 'Open the link to update payment details, download invoices, or cancel. Cancelling drops the key to Free at the end of the billing period.' };
    },
  };
}

const rpcError = (id: unknown, text: string) => Response.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/health')) {
    const { data } = await db.from('market_latest').select('fetched_at').eq('id', 1).maybeSingle();
    return Response.json({ ok: true, name: 'yieldcave', version: VERSION, marketFetchedAt: data?.fetched_at ?? null });
  }
  let parsedBody: unknown = undefined;
  let caller: Caller | null = null;
  let toolName: string | null = null;
  if (req.method === 'POST') {
    try { parsedBody = await req.json(); } catch { return Response.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, { status: 400 }); }
    const msg = parsedBody as { method?: string; id?: unknown; params?: { name?: string } };
    if (msg?.method === 'tools/call') {
      caller = await identify(req);
      toolName = msg.params?.name ?? null;
      const used = await callsToday(caller.subject);
      const allow = allowance(caller.tier, used);
      if (!allow.allowed) return rpcError(msg.id, limitMessage('calls', caller.tier));
      if (caller.tier === 'anonymous' && toolName && KEY_TOOLS.has(toolName) && toolName !== 'create_api_key') {
        return rpcError(msg.id, `${toolName} needs an API key. ${PLANS.free.how} Endpoint for claude.ai: ${SUPABASE_URL}/functions/v1/mcp?key=<your key>`);
      }
    }
  }
  caller ??= await identify(req);
  const server = createServer({ loadMarket, history, alerts: alertsFor(caller), account: accountFor(caller) });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req, { parsedBody });
  if (toolName) db.rpc('increment_usage', { p_subject: caller.subject, p_tool: toolName }).then(() => {}, () => {});
  return res;
});
