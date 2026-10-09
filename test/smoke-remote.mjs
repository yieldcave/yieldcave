// Checks a deployed YieldCave endpoint end to end, including keys and metering.
// Usage: YIELDCAVE_URL=https://<ref>.supabase.co/functions/v1/mcp npm run smoke:remote
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.YIELDCAVE_URL;
if (!url) { console.error('set YIELDCAVE_URL'); process.exit(2); }
const connect = async (headers = {}) => { const c = new Client({ name: 'yieldcave-smoke-remote', version: '0.0.0' }); await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } })); return c; };
const call = async (c, name, args = {}) => { const r = await c.callTool({ name, arguments: args }); const text = r.content[0].text; let body; try { body = JSON.parse(text); } catch { body = { text }; } return { ...body, isError: r.isError ?? false }; };
const fails = [];
const check = (ok, what) => { console.log(ok ? '  ok ' : '  FAIL', what); if (!ok) fails.push(what); };

const health = await fetch(url.replace(/\/mcp\/?$/, '/mcp/health')).then((r) => r.json());
check(health.ok && health.marketFetchedAt, `health ${health.version} market ${health.marketFetchedAt}`);

const anon = await connect();
const { tools } = await anon.listTools();
check(tools.length === 16, `16 tools, got ${tools.length}: ${tools.map((t) => t.name).join(', ')}`);
const s = await call(anon, 'rwa_market_summary');
check(s.tokenizedTreasuries?.distinctTokens > 0, `summary: ${s.tokenizedTreasuries?.distinctTokens} tokens, TVL ${s.tokenizedTreasuries?.totalTvlUsd}`);
const h = await call(anon, 'rwa_history', { symbol: 'BUIDL', days: 7 });
check(h.days >= 1, `history ${h.days} day(s)`);
const st = await call(anon, 'stablecoin_yield_summary');
check(st.totals?.pools > 50 && st.stablecoins?.[0]?.symbol, `stablecoins: ${st.totals?.pools} pools, $${st.totals?.tvlUsd}, top ${st.stablecoins?.[0]?.symbol}`);
const sl = await call(anon, 'list_stablecoin_yields', { symbol: 'USDC', group: 'lending', limit: 3 });
check(sl.pools?.length === 3 && sl.pools.every((p) => p.group === 'lending'), `USDC lending venues: ${sl.pools?.map((p) => p.project + '@' + p.chain + ' ' + p.apyPercent + '%').join(', ')}`);
const t = await call(anon, 'rwa_issuer_terms', { symbol: 'USYC' });
check(t.found && t.eligibility?.usPersons === 'excluded', 'issuer terms USYC');
const blocked = await call(anon, 'create_alert', { metric: 'apy', operator: 'above', threshold: 1, webhookUrl: 'https://httpbin.org/post' });
check(blocked.isError && /API key/.test(JSON.stringify(blocked)), 'anonymous create_alert is refused');

const email = `smoke+${Date.now()}@example.com`;
const k = await call(anon, 'create_api_key', { email });
check(k.created && k.apiKey?.startsWith('yc_'), `key created for ${email}`);
const dup = await call(anon, 'create_api_key', { email });
check(dup.created === false, 'second key for same email refused');
await anon.close();

const keyed = await connect({ 'x-api-key': k.apiKey });
const u = await call(keyed, 'my_usage');
check(u.plan === 'Free' && u.calls.limit === 1000, `my_usage: plan ${u.plan}, ${u.calls.used}/${u.calls.limit} used`);
const a = await call(keyed, 'create_alert', { metric: 'apy', operator: 'above', threshold: 1, symbol: 'USDY', webhookUrl: 'https://httpbin.org/post', label: 'smoke' });
check(a.id && a.alertsLimit === 3, `alert created ${a.id} (${a.alertsUsed}/${a.alertsLimit})`);
const l = await call(keyed, 'list_alerts');
check(l.alerts.some((x) => x.id === a.id) && !JSON.stringify(l).includes('httpbin.org/post'), 'list shows my alert, no full URL');
const up = await call(keyed, 'upgrade');
check(typeof up.note === 'string', `upgrade: ${up.url ? 'checkout url returned' : up.note}`);
const d = await call(keyed, 'delete_alert', { id: a.id });
check(d.deleted === true, 'alert deleted');
const u2 = await call(keyed, 'my_usage');
check(u2.calls.used >= u.calls.used + 3, `metering counted calls (${u.calls.used} -> ${u2.calls.used})`);
await keyed.close();

console.log(fails.length ? `SMOKE-REMOTE FAIL (${fails.length})` : 'SMOKE-REMOTE PASS');
process.exit(fails.length ? 1 : 0);
