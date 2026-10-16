// mcp.yieldcave.com: forwards every request to the YieldCave MCP Edge Function on Supabase.
// Paths map 1:1 (/ -> /functions/v1/mcp, /health -> /functions/v1/mcp/health); query (?key=) and headers pass through.
// Sets x-forwarded-for to the caller's IP so per-IP anonymous limits keep working behind the proxy.
const ORIGIN = 'https://ccvhvxbqtvqbhexhrjnj.supabase.co/functions/v1/mcp';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // OpenAI domain verification: the token is stored as the Worker secret OPENAI_APPS_CHALLENGE.
    if (url.pathname === '/.well-known/openai-apps-challenge') {
      const token = env?.OPENAI_APPS_CHALLENGE;
      return token ? new Response(token, { headers: { 'content-type': 'text/plain' } }) : new Response('not configured', { status: 404 });
    }
    const target = ORIGIN + (url.pathname === '/' ? '' : url.pathname) + url.search;
    const headers = new Headers(req.headers);
    headers.delete('host');
    const ip = req.headers.get('cf-connecting-ip');
    if (ip) headers.set('x-forwarded-for', ip);
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    return fetch(target, { method: req.method, headers, body: hasBody ? req.body : undefined, redirect: 'manual' });
  },
};
