// mcp.yieldcave.com: forwards every request to the YieldCave MCP Edge Function on Supabase.
// Paths map 1:1 (/ -> /functions/v1/mcp, /health -> /functions/v1/mcp/health); query (?key=) and headers pass through.
// Sets x-forwarded-for to the caller's IP so per-IP anonymous limits keep working behind the proxy.
const ORIGIN = 'https://ccvhvxbqtvqbhexhrjnj.supabase.co/functions/v1/mcp';

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const target = ORIGIN + (url.pathname === '/' ? '' : url.pathname) + url.search;
    const headers = new Headers(req.headers);
    headers.delete('host');
    const ip = req.headers.get('cf-connecting-ip');
    if (ip) headers.set('x-forwarded-for', ip);
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    return fetch(target, { method: req.method, headers, body: hasBody ? req.body : undefined, redirect: 'manual' });
  },
};
