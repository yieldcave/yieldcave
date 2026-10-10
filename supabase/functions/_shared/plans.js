// Plans. Live data is free; depth is paid. Pure functions; the hosted endpoint enforces them, self-hosted servers ignore them.
export const PLANS = {
  anonymous: {
    name: 'Anonymous', price: '$0', callsPerDay: 1000, alerts: 0,
    historyDays: 7, changesDays: 1, stableGroups: ['lending', 'vault'], stableRows: 10, issuerTerms: 'summary',
    how: 'No key. Limit is per IP address per UTC day.',
  },
  free: {
    name: 'Free', price: '$0', callsPerDay: 1000, alerts: 3,
    historyDays: 7, changesDays: 1, stableGroups: ['lending', 'vault'], stableRows: 10, issuerTerms: 'summary',
    how: 'Already have a key? Send it as an x-api-key header (or Authorization: Bearer). On claude.ai, which cannot send headers, the user (not the assistant) must edit the connector in claude.ai settings so its URL ends with ?key=<your key>. No key yet? Call create_api_key with your email; it is free and shown once.',
  },
  pro: {
    name: 'Pro', price: '$49/month', callsPerDay: 5000, alerts: 100,
    historyDays: 365, changesDays: 365, stableGroups: ['lending', 'vault', 'credit', 'basis', 'other'], stableRows: 100, issuerTerms: 'full',
    how: 'Call upgrade with your key to get a checkout link.',
  },
};

export const PLAN_SUMMARY = {
  free: 'Live market and stablecoin tools, 7 days of history, 1-day changes, lending and vault venues, issuer-terms summaries. 1,000 calls/day; 3 alerts with a free key.',
  pro: 'Everything in Free plus full history and changes, all stablecoin venues (credit and basis included, up to 100 rows), full issuer-terms records with sources, 100 alerts, 5,000 calls/day. $49/month.',
};

export const UPGRADE_NOTE = `Pro includes this. ${PLAN_SUMMARY.pro} Call upgrade for a checkout link.`;

export function allowance(tier, callsToday) {
  const plan = PLANS[tier] ?? PLANS.anonymous;
  const remaining = Math.max(0, plan.callsPerDay - callsToday);
  return { tier, limit: plan.callsPerDay, used: callsToday, remaining, allowed: callsToday < plan.callsPerDay };
}

export function alertAllowance(tier, activeAlerts) {
  const plan = PLANS[tier] ?? PLANS.anonymous;
  return { tier, limit: plan.alerts, used: activeAlerts, allowed: activeAlerts < plan.alerts };
}

export function limitMessage(kind, tier) {
  const plan = PLANS[tier] ?? PLANS.anonymous;
  if (kind === 'calls') {
    return tier === 'pro'
      ? `Daily limit reached (${plan.callsPerDay} calls on the Pro plan). Contact support to raise it.`
      : tier === 'free'
        ? `Daily limit reached (${plan.callsPerDay} calls on the Free plan). Call upgrade for Pro (${PLANS.pro.callsPerDay} calls per day, ${PLANS.pro.price}).`
        : `Daily limit reached (${plan.callsPerDay} calls per IP without a key). Create a free API key with create_api_key, or call upgrade for Pro.`;
  }
  return tier === 'anonymous'
    ? 'Alerts need an API key. Call create_api_key with your email (free).'
    : `Alert limit reached (${plan.alerts} on the ${plan.name} plan).${tier === 'free' ? ' Call upgrade for Pro (100 alerts).' : ''}`;
}

export const KEY_TOOLS = new Set(['create_alert', 'list_alerts', 'delete_alert', 'my_usage', 'upgrade', 'manage_subscription']);

// ---- Depth gating. `plan` is a PLANS entry, or null for self-hosted (no limits).
export function clampDays(plan, days, kind) {
  if (!plan) return { days, limited: false };
  const max = kind === 'changes' ? plan.changesDays : plan.historyDays;
  return days > max ? { days: max, limited: true, max } : { days, limited: false };
}

export function stableAccess(plan, { group, limit }) {
  if (!plan) return { groups: null, limit, limited: false, deniedGroup: null };
  const allowed = plan.stableGroups;
  const deniedGroup = group && !allowed.includes(group) ? group : null;
  const rows = Math.min(limit ?? plan.stableRows, plan.stableRows);
  return { groups: allowed, limit: rows, limited: rows < (limit ?? rows) || allowed.length < 5, deniedGroup };
}

export function trimIssuerTerms(plan, record) {
  if (!plan || plan.issuerTerms === 'full' || !record.found) return record;
  const { symbol, found, verifiedOn, name, issuer, productType, eligibility, minimums, confidence } = record;
  return {
    symbol, found, verifiedOn, name, issuer, productType, eligibility,
    minimums: { initialUsd: minimums?.initialUsd ?? null }, confidence,
    summaryOnly: true,
    note: `Summary record. Full terms (underlying, domicile, redemption method and timing, fees, yield mechanics, custodian, source URLs) are on Pro. ${UPGRADE_NOTE}`,
  };
}
