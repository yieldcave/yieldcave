# YieldCave

**Machine-readable onchain yield data for AI agents: tokenized treasuries and stablecoin venues.**

YieldCave is an [MCP](https://modelcontextprotocol.io) server. Add it to Claude Desktop, Claude Code or Cursor and your agent can answer questions like:

- "What tokenized US treasuries are on Solana right now, and what do they yield?"
- "How much more would $25k earn in the best liquid tokenized treasury than in my 0.4% savings account?"
- "Summarize the tokenized RWA market."
- "Where does USDC earn the most on a collateralized lending market with at least $50M behind it?"

It is **read-only**. It never touches a wallet, never moves money and never recommends. That is the point: an index, not a broker.

Data comes from DefiLlama's public API. No API key is needed.

## 1. Run it locally (5 minutes)

You need Node 20 or newer (`node --version`).

```bash
cd ~/yieldcave && npm install
```

See the data in your terminal:

```bash
npm run demo
```

Run the unit tests (no network needed):

```bash
npm test
```

Run the end-to-end checks, which start the real MCP server and call it the way Claude would, over stdio and over HTTP:

```bash
npm run smoke && npm run smoke:http
```

## 2. Add it to Claude Desktop

Open this file (create it if it does not exist):

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Add YieldCave under `mcpServers`. If the file already has other servers, add just the `"yieldcave"` block inside the existing object.

```json
{
  "mcpServers": {
    "yieldcave": {
      "command": "node",
      "args": ["/Users/bjf/yieldcave/src/server.js"]
    }
  }
}
```

Quit and reopen Claude Desktop. You should see a tools icon with four YieldCave tools. Try: *"Use YieldCave to summarize the tokenized treasury market."*

## 3. Add it to Claude Code

```bash
claude mcp add yieldcave -- node /Users/bjf/yieldcave/src/server.js
```

## 3b. Use it from claude.ai in a browser (hosted version)

YieldCave also runs in the cloud on Supabase, so claude.ai (and anyone else) can reach it without your Mac being on.

```
https://ccvhvxbqtvqbhexhrjnj.supabase.co/functions/v1/mcp
```

In claude.ai: Customize → Connectors → Add → Add custom connector → paste that URL, no sign-in. The hosted version serves data from Postgres, which a scheduled job refreshes every hour, and it keeps one snapshot per day. That history powers the fifth tool, `rwa_history`.

How the hosted version is put together, all inside the `supabase/` folder:

```
supabase/functions/_shared/   the real code: data.js, tools.js, mcp.js (src/ re-exports these)
supabase/functions/mcp/       public MCP endpoint, reads market_latest and snapshots from Postgres
supabase/functions/refresh/   fetches DefiLlama, writes market_latest + today's snapshot, fires alerts; needs REFRESH_SECRET header
supabase/functions/stripe-webhook/  upgrades/downgrades keys on Stripe events
supabase/functions/site/      serves the landing page (pages.js is generated from site/)
supabase/migrations/          tables (market, snapshots, alerts, api_keys, usage_daily), RLS on, hourly pg_cron job, public site bucket
scripts/                      configure-stripe.sh, publish-site.sh
```

To redeploy after a change:

```bash
supabase functions deploy mcp --no-verify-jwt --use-api && supabase functions deploy refresh --no-verify-jwt --use-api
```

Check a deployment end to end (tools, history, and an alert that creates, fires, and deletes itself):

```bash
set -a; source .env.local; set +a; YIELDCAVE_URL=https://ccvhvxbqtvqbhexhrjnj.supabase.co/functions/v1/mcp npm run smoke:remote && npm run smoke:alerts
```

Secrets (database password, refresh secret) live in `.env.local`, which git ignores. Never commit them.

## 4. The tools

| Tool | What it returns |
|---|---|
| `list_rwa_yields` | Tokenized RWA deployments with APY and TVL. Filter by `chain`, `kind` (`treasury` or `other_rwa`), `minTvlUsd`; sort by `tvlUsd` or `apy` |
| `get_rwa_asset` | One symbol (e.g. `BUIDL`) across every chain, with total TVL and a curated description |
| `list_stablecoin_yields` | Single-asset stablecoin pools (USDC, USDT, DAI, USDe, ...) on lending, vault, credit and basis venues, each labelled by group, with base vs reward APY, 30-day mean and TVL. $10M floor by default |
| `stablecoin_yield_summary` | Per stablecoin: venues, TVL, median APY, best venue overall and best collateralized-lending venue; totals by group; tokenized-treasury median for comparison |
| `rwa_market_summary` | Totals: distinct treasury tokens, TVL, median APY, top five, plus other RWA totals |
| `compare_yield_to_tokenized_treasuries` | Simple-interest arithmetic: your current APY vs the best liquid tokenized treasury over a horizon, with assumptions spelled out |
| `rwa_issuer_terms` | Hand-curated terms for BUIDL, USYC, USDY, OUSG, USTB, TBILL, STBT, BENJI: structure, eligibility (US persons?), minimums, redemption, fees, sources, date verified |
| `rwa_history` | Daily TVL and TVL-weighted APY for one symbol over the last N days, with the change. `universe` is `rwa` or `stablecoin`. Hosted: from Postgres snapshots. Local: from `npm run snapshot` files |
| `rwa_changes` | What moved since N days ago: APY and TVL change per deployment, new and vanished deployments (hosted, or local with snapshots) |
| `create_alert`, `list_alerts`, `delete_alert` | Hosted only, needs a key. A rule such as "any treasury APY above 4.5" or "USDY TVL below $1B". Checked hourly; fires a JSON POST to your HTTPS webhook (Slack, Discord, Zapier, your server) at most once per 24 hours |
| `create_api_key`, `my_usage`, `upgrade`, `manage_subscription` | Hosted only. Free key by email (shown once), plan and usage, a Pro checkout link, and a Stripe billing-portal link to change or cancel |

## 4b. Plans, keys and metering (hosted)

| Plan | Price | Calls/day | Alerts | History | Changes | Stablecoin venues | Issuer terms |
|---|---|---|---|---|---|---|---|
| Anonymous | $0 | 1,000 per IP | 0 | 7 days | 1 day back | lending and vault, 10 rows | summary |
| Free key | $0 | 1,000 | 3 | 7 days | 1 day back | lending and vault, 10 rows | summary |
| Pro | $49/month | 5,000 | 100 | full | any range | all groups, 100 rows | full record with sources |

Live data is free; depth is paid. Get a key by asking your agent to call `create_api_key` with your email; send it as an `x-api-key` header (or `Authorization: Bearer`), or as `?key=yc_...` on the connector URL for claude.ai. Pro is bought with the `upgrade` tool (Stripe checkout) and managed with `manage_subscription`. Self-hosted servers have no plan limits.

**claude.ai setup with a key.** Custom connectors in claude.ai cannot send request headers, so the key goes in the URL: add a custom connector with `https://ccvhvxbqtvqbhexhrjnj.supabase.co/functions/v1/mcp?key=yc_your_key` and "No sign-in". A header (`x-api-key` or `Authorization: Bearer`) wins when both are present. The server never logs query strings or keys. Treat the URL as a secret, since anyone holding it holds the key.

Every `tools/call` is counted in the `usage_daily` table against the key, or a hashed IP for anonymous callers. Limits reset at midnight UTC. Keys are stored as SHA-256 hashes; the plain key is returned once and never again. Alerts belong to the key that created them. All of this is in `supabase/functions/mcp/index.ts`; the limits themselves are in `supabase/functions/_shared/plans.js`.

**Switching on payments** needs a Stripe account and three values. Create a recurring $49/month product, add a webhook endpoint for `https://ccvhvxbqtvqbhexhrjnj.supabase.co/functions/v1/stripe-webhook` with the events `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`, then run:

```bash
./scripts/configure-stripe.sh sk_live_... price_... whsec_...
```

Until then, `upgrade` returns a polite "payments are not switched on yet". The webhook upgrades a key to Pro when checkout completes and downgrades it when the subscription ends; `manage_subscription` opens Stripe's billing portal (return URL https://yieldcave.com). Checkout success and cancel pages are https://yieldcave.com/thanks and https://yieldcave.com; a `SITE_URL` secret overrides both if you ever need to.

**Landing page** is https://yieldcave.com, hosted on Cloudflare (Workers static assets, the current form of Cloudflare Pages). Edit `site/*.html`, then publish with `./scripts/publish-site.sh`, which runs `wrangler pages deploy` (one-time `npx wrangler login` first). The `site` Edge Function is a fallback copy of the same pages and is not linked from anywhere.

Every response carries a disclaimer and the time the data was fetched. Issuer terms are curated by hand in `supabase/functions/_shared/issuers.js` with a `verifiedOn` date and source URLs; update that file when terms change.

## 5. Project layout

```
src/data.js     re-export of supabase/functions/_shared/data.js (fetch, normalize, cache, local snapshots)
src/tools.js    re-export of _shared/tools.js: pure functions behind each tool (unit-tested)
src/mcp.js      re-export of _shared/mcp.js: declares the five tools
src/snapshot.js saves today's market locally (npm run snapshot)
src/server.js   stdio entry point: Claude Desktop, Claude Code, Cursor
src/http.js     HTTP entry point: claude.ai custom connectors, remote clients
src/demo.js     prints a summary table in the terminal
test/           unit tests (node --test) and a live smoke test
site/           landing page with a live table (npm run site, then open http://localhost:8080)
```

## 6. How it works, for someone new to APIs

An **API** is a URL that returns data instead of a web page. Open `https://yields.llama.fi/pools` in a browser and you will see raw JSON for ~16,000 yield pools. `src/data.js` downloads that, keeps only the pools DefiLlama classifies as real-world assets, and reshapes each one into a dozen clearly named fields.

**MCP** is a small protocol that lets an AI model call functions you define. `src/server.js` tells the model "here are four functions, here is what each argument means"; when the model decides to call one, the server runs the matching function in `src/tools.js` and hands back JSON. Claude reads that JSON and writes the answer in English.

The server talks over **stdio** (standard input/output), which is why `console.log` is banned inside it: anything printed to stdout would corrupt the protocol stream. Use `console.error` for debugging.

## 7. Next steps

Hosted endpoint, history, issuer terms, webhook alerts, API keys and metering are live. Pro needs only a Stripe account to switch on. Next: a custom domain, and more asset classes (tokenized equities).

## Disclaimer

Information only, not financial advice. Figures come from public third-party data and may be delayed or wrong. Verify with the issuer before acting.

## License

MIT
