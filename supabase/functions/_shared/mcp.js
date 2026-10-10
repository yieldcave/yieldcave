// Shared tool definitions. Every entry point (stdio, Node HTTP, Supabase Edge Function) calls createServer().
//   loadMarket: async () => market        (default: live DefiLlama fetch with a 10-minute cache)
//   history:    { load(days) => [{day, assets}] } or null   (adds the rwa_history tool when present)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadMarket as liveLoadMarket } from './data.js';
import { listAssets, getAsset, marketSummary, compareYield, historySeries, marketChanges, listStables, stablecoinSummary } from './tools.js';
import { issuerTerms, ISSUERS, DISCLAIMER_NOTE } from './issuers.js';
import { PLANS, UPGRADE_NOTE, clampDays, stableAccess, trimIssuerTerms } from './plans.js';

const asJson = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

//   alerts:     { create(row) => row, list() => rows, remove(id) => boolean } or null   (adds the alert tools)
//   account:    { usage(), createKey(email), checkout(), portal() } or null   (adds the account tools)
//   plan:       a PLANS entry for the caller (hosted) or null (self-hosted: no depth limits)
export function createServer({ loadMarket = liveLoadMarket, history = null, alerts = null, account = null, plan = null } = {}) {
  const server = new McpServer({ name: 'yieldcave', version: '0.8.0' });

  server.registerTool(
    'list_rwa_yields',
    {
      title: 'List tokenized real-world asset yields',
      description:
        'Lists tokenized real-world asset deployments (tokenized US treasuries, credit, funds) with current APY and TVL, from public DefiLlama data. Filter by chain or kind. Information only, not advice.',
      inputSchema: {
        chain: z.string().optional().describe('Blockchain name, e.g. "Ethereum", "Solana", "Base"'),
        kind: z.enum(['treasury', 'other_rwa']).optional().describe('"treasury" = tokenized US government debt / money-market style'),
        minTvlUsd: z.number().nonnegative().optional().describe('Minimum total value locked in USD (default 1,000,000)'),
        limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 20)'),
        sortBy: z.enum(['tvlUsd', 'apy']).optional().describe('Sort key (default tvlUsd)'),
      },
    },
    async (args) => asJson(listAssets(await loadMarket(), args)),
  );

  server.registerTool(
    'get_rwa_asset',
    {
      title: 'Get one tokenized asset across chains',
      description: 'Returns every deployment of one tokenized asset symbol (e.g. BUIDL, USDY, OUSG) across chains, with total TVL and curated description.',
      inputSchema: { symbol: z.string().min(1).describe('Token symbol, e.g. "BUIDL"') },
    },
    async ({ symbol }) => asJson(getAsset(await loadMarket(), symbol)),
  );

  server.registerTool(
    'rwa_market_summary',
    {
      title: 'Tokenized RWA market summary',
      description: 'Totals for the tokenized treasury market: distinct tokens, total TVL, median APY, top tokens by TVL, plus totals for other tokenized real-world assets.',
      inputSchema: {},
    },
    async () => asJson(marketSummary(await loadMarket())),
  );

  server.registerTool(
    'compare_yield_to_tokenized_treasuries',
    {
      title: 'Compare a yield to tokenized treasuries',
      description:
        'Given an APY the user currently earns (e.g. a bank savings rate), computes the simple-interest difference versus the highest-yielding liquid tokenized treasury over a horizon. Returns arithmetic and assumptions only; it does not recommend.',
      inputSchema: {
        currentApyPercent: z.number().min(0).max(100).describe('APY the user earns today, in percent, e.g. 0.5'),
        amountUsd: z.number().positive().optional().describe('Amount in USD (default 10,000)'),
        horizonDays: z.number().int().positive().optional().describe('Horizon in days (default 365)'),
        minTvlUsd: z.number().nonnegative().optional().describe('Liquidity floor for candidates (default 50,000,000)'),
      },
    },
    async (args) => asJson(compareYield(await loadMarket(), args)),
  );

  server.registerTool(
    'list_stablecoin_yields',
    {
      title: 'Stablecoin yields by venue',
      description:
        'Where USDC, USDT, DAI, USDe and other stablecoins earn yield right now: single-asset pools on lending markets and vaults (credit and basis venues on Pro) (DefiLlama data, excludes tokenized treasuries, which have their own tools). Each row carries its protocol category group (lending, vault, credit, basis), base vs reward APY, 30-day mean APY and TVL. Default: pools with at least $10M TVL, highest APY first. Information only, not advice.',
      inputSchema: {
        symbol: z.string().optional().describe('Stablecoin symbol, e.g. "USDC"'),
        chain: z.string().optional().describe('Blockchain name, e.g. "Base"'),
        group: z.enum(['lending', 'vault', 'credit', 'basis', 'other']).optional().describe('Risk/category group'),
        majorOnly: z.boolean().optional().describe('Only major stablecoins (USDC, USDT, DAI, USDS, USDe, PYUSD, ...)'),
        minTvlUsd: z.number().nonnegative().optional().describe('Minimum pool TVL in USD (default 10,000,000)'),
        sortBy: z.enum(['apy', 'tvlUsd']).optional().describe('Default apy'),
        limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 20)'),
      },
    },
    async (args) => {
      const access = stableAccess(plan, { group: args.group, limit: args.limit });
      if (access.deniedGroup) return asJson({ matched: 0, pools: [], deniedGroup: access.deniedGroup, note: `The ${access.deniedGroup} group (and its yields) is on Pro. Free and anonymous callers see lending and vault venues. ${UPGRADE_NOTE}` });
      const market = await loadMarket();
      const filtered = access.groups ? { ...market, stables: (market.stables ?? []).filter((p) => access.groups.includes(p.group)) } : market;
      const out = listStables(filtered, { ...args, limit: access.limit });
      if (access.limited) out.planNote = `Showing ${access.groups?.join(' and ')} venues, up to ${access.limit} rows. ${UPGRADE_NOTE}`;
      return asJson(out);
    },
  );

  server.registerTool(
    'stablecoin_yield_summary',
    {
      title: 'Stablecoin yield market summary',
      description:
        'Per stablecoin: venues, total TVL, median APY, best venue overall and best collateralized-lending venue; totals by category group; and the median tokenized treasury APY for comparison. Pools with at least $10M TVL by default.',
      inputSchema: { minTvlUsd: z.number().nonnegative().optional().describe('Pool TVL floor (default 10,000,000)') },
    },
    async (args) => asJson(stablecoinSummary(await loadMarket(), args)),
  );

  server.registerTool(
    'rwa_issuer_terms',
    {
      title: 'Issuer terms for a tokenized treasury',
      description:
        `Hand-curated terms for a tokenized treasury token: who may invest (US persons?), minimum, structure (summary on Free; Pro adds what backs it, domicile, redemption method and timing, fees, yield mechanics and source URLs). Covers ${Object.keys(ISSUERS).join(', ')}. Null means not stated by the source.`,
      inputSchema: { symbol: z.string().min(1).describe('Token symbol, e.g. "USYC"') },
    },
    async ({ symbol }) => asJson({ ...trimIssuerTerms(plan, issuerTerms(symbol)), disclaimer: DISCLAIMER_NOTE }),
  );

  if (history) {
    server.registerTool(
      'rwa_history',
      {
        title: 'Daily history for one tokenized asset',
        description:
          'Daily snapshots of total TVL and TVL-weighted APY for one symbol, optionally on one chain, over the last N days (default 30; Free and anonymous plans see 7, Pro the full history). universe "rwa" (tokenized assets, default) or "stablecoin" (stablecoin pools). Includes the change from first to last day.',
        inputSchema: {
          symbol: z.string().min(1).describe('Symbol, e.g. "USDY" or "USDC"'),
          chain: z.string().optional().describe('Restrict to one chain'),
          days: z.number().int().min(1).max(365).optional().describe('How many days back (default 30)'),
          universe: z.enum(['rwa', 'stablecoin']).optional().describe('Default rwa'),
        },
      },
      async ({ symbol, chain, days = 30, universe = 'rwa' }) => {
        const c = clampDays(plan, days, 'history');
        const out = historySeries(await history.load(c.days), { symbol, chain, days: c.days, universe });
        if (c.limited) out.planNote = `History limited to ${c.max} days on this plan. ${UPGRADE_NOTE}`;
        return asJson(out);
      },
    );
  }

  if (history) {
    server.registerTool(
      'rwa_changes',
      {
        title: 'What changed in the tokenized RWA market',
        description:
          'Compares the latest market with the snapshot from N days ago (default 1): APY and TVL change per deployment, biggest movers first, plus new and vanished deployments. universe "rwa" (default) or "stablecoin".',
        inputSchema: {
          days: z.number().int().min(1).max(365).optional().describe('How many days back to compare against (default 1)'),
          kind: z.enum(['treasury', 'other_rwa']).optional().describe('Default "treasury" (rwa universe only)'),
          universe: z.enum(['rwa', 'stablecoin']).optional().describe('Default rwa'),
          limit: z.number().int().min(1).max(100).optional().describe('Max movers (default 15)'),
        },
      },
      async ({ days = 1, kind = 'treasury', limit = 15, universe = 'rwa' }) => {
        const c = clampDays(plan, days, 'changes');
        days = c.days;
        const [latest, snaps] = await Promise.all([loadMarket(), history.load(days + 1)]);
        const older = [...snaps].sort((a, b) => (a.day < b.day ? -1 : 1))[0];
        if (!older) return asJson({ note: 'No earlier snapshot available yet.', disclaimer: historySeries([], {}).disclaimer });
        const out = marketChanges(latest, { fetchedAt: older.day, assets: older.assets, stables: older.stables ?? [] }, { kind, limit, universe });
        if (c.limited) out.planNote = `Changes limited to ${c.max} day(s) back on this plan. ${UPGRADE_NOTE}`;
        return asJson(out);
      },
    );
  }

  if (alerts) {
    server.registerTool(
      'create_alert',
      {
        title: 'Create a webhook alert',
        description:
          'Creates a rule that is checked every hour after the data refresh. When any matching deployment crosses the threshold, YieldCave POSTs a JSON payload to your HTTPS webhook (Slack, Discord, Zapier, your own server). Fires at most once per 24 hours per rule. universe "rwa" (tokenized treasuries, default) or "stablecoin" (stablecoin pools with at least $10M TVL; omit symbol for all major stablecoins). Returns the alert id; keep it to delete the alert later.',
        inputSchema: {
          universe: z.enum(['rwa', 'stablecoin']).optional().describe('Default rwa'),
          metric: z.enum(['apy', 'tvl']).describe('"apy" in percent, "tvl" in USD'),
          operator: z.enum(['above', 'below']),
          threshold: z.number().describe('e.g. 4.5 for APY, 500000000 for TVL'),
          webhookUrl: z.string().url().startsWith('https://').describe('Where to POST when the alert fires'),
          symbol: z.string().optional().describe('One token, e.g. "USDY". Omit for every tokenized treasury'),
          chain: z.string().optional().describe('Restrict to one chain'),
          label: z.string().max(80).optional().describe('Free text shown in the payload'),
        },
      },
      async (args) => asJson(await alerts.create(args)),
    );
    server.registerTool(
      'list_alerts',
      { title: 'List alerts', description: 'Lists active alert rules (webhook hosts only, never full URLs).', inputSchema: {} },
      async () => asJson({ alerts: await alerts.list() }),
    );
    server.registerTool(
      'delete_alert',
      { title: 'Delete an alert', description: 'Deletes an alert by id.', inputSchema: { id: z.string().uuid() } },
      async ({ id }) => asJson({ id, deleted: await alerts.remove(id) }),
    );
  }

  if (account) {
    server.registerTool(
      'create_api_key',
      {
        title: 'Create a free API key',
        description:
          `Creates a free YieldCave API key (${PLANS.free.callsPerDay} calls/day, ${PLANS.free.alerts} alerts, 7 days of history) tied to an email address. The key is shown once. Send it on every request as an x-api-key header or Authorization: Bearer. One key per email.`,
        inputSchema: { email: z.string().email().describe('Where to reach you about the key') },
      },
      async ({ email }) => asJson(await account.createKey(email)),
    );
    server.registerTool(
      'my_usage',
      { title: 'My plan and usage', description: 'Shows the caller\'s plan, calls used today, remaining allowance, alert allowance, depth limits, and what each plan includes.', inputSchema: {} },
      async () => asJson({ ...(await account.usage()), plans: PLANS }),
    );
    server.registerTool(
      'upgrade',
      { title: 'Upgrade to Pro', description: `Returns a checkout link for the Pro plan (${PLANS.pro.price}: full history and changes, all stablecoin venues, full issuer terms, ${PLANS.pro.alerts} alerts, ${PLANS.pro.callsPerDay} calls/day). Needs an API key.`, inputSchema: {} },
      async () => asJson(await account.checkout()),
    );
    server.registerTool(
      'manage_subscription',
      { title: 'Manage subscription', description: 'Returns a Stripe Billing Portal link to update payment details, see invoices, or cancel the Pro subscription. Needs an API key with a subscription.', inputSchema: {} },
      async () => asJson(await account.portal()),
    );
  }

  return server;
}
