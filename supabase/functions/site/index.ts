// Serves the landing page and the post-checkout page. Pages are bundled into pages.js by scripts/publish-site.sh.
import { PAGES, PAGES_TEXT } from './pages.js';

Deno.serve((req) => {
  const path = new URL(req.url).pathname.replace(/^.*\/site\/?/, '').replace(/\.html$/, '') || 'index';
  const html = (PAGES as Record<string, string>)[path];
  const HTML = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' };
  if (!html) return new Response('<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found.</p>', { status: 404, headers: HTML });
  // Supabase rewrites HTML to text/plain on *.supabase.co (anti-phishing). Serve a readable plain-text version there,
  // so a customer sent here after checkout sees words, not markup. On a custom domain the HTML is served as-is.
  if (new URL(req.url).hostname.endsWith('.supabase.co')) {
    return new Response((PAGES_TEXT as Record<string, string>)[path], { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  }
  return new Response(html, { headers: HTML });
});
