// End-to-end alert check against a deployed endpoint. Needs YIELDCAVE_URL and REFRESH_SECRET (from .env.local).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const url = process.env.YIELDCAVE_URL; const secret = process.env.REFRESH_SECRET;
// Alerts need an API key, so create a throwaway one first and connect with it.
const email = `smoke+alerts${Date.now()}@example.com`;
const c0 = new Client({ name: 'alert-e2e', version: '0' }); await c0.connect(new StreamableHTTPClientTransport(new URL(url)));
const key = JSON.parse((await c0.callTool({ name: 'create_api_key', arguments: { email } })).content[0].text).apiKey; await c0.close();
const c = new Client({ name: 'alert-e2e', version: '0' }); await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { 'x-api-key': key } } }));
const call = async (name, args) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);
const created = await call('create_alert', { metric: 'apy', operator: 'above', threshold: 1, symbol: 'USDY', webhookUrl: 'https://httpbin.org/post', label: 'e2e test' });
console.log('created:', created.id, created.webhookHost);
const r = await fetch(url.replace(/\/mcp\/?$/, '/refresh'), { method: 'POST', headers: { 'x-refresh-secret': secret, 'content-type': 'application/json' }, body: '{}' }).then((x) => x.json());
console.log('refresh:', JSON.stringify(r));
const list = await call('list_alerts', {}); const mine = list.alerts.find((a) => a.id === created.id);
console.log('after refresh last_fired_at:', mine?.last_fired_at, 'webhookHost:', mine?.webhookHost, 'url leaked?', JSON.stringify(mine).includes('httpbin.org/post'));
const r2 = await fetch(url.replace(/\/mcp\/?$/, '/refresh'), { method: 'POST', headers: { 'x-refresh-secret': secret, 'content-type': 'application/json' }, body: '{}' }).then((x) => x.json());
console.log('second refresh (mine must not re-fire within 24h):', JSON.stringify(r2));
const mine2 = JSON.parse((await c.callTool({ name: 'list_alerts', arguments: {} })).content[0].text).alerts.find((a) => a.id === created.id);
const del = await call('delete_alert', { id: created.id }); console.log('deleted:', del.deleted);
const changes = await call('rwa_changes', { days: 1 }); console.log('changes:', changes.note ?? `${changes.movers.length} movers from ${changes.from}`);
await c.close();
const ok = r.alertsFired >= 1 && mine?.last_fired_at && !JSON.stringify(mine).includes('httpbin.org/post') && mine2?.last_fired_at === mine?.last_fired_at && del.deleted === true;
console.log(ok ? 'ALERT-E2E PASS' : 'ALERT-E2E FAIL'); process.exit(ok ? 0 : 1);
