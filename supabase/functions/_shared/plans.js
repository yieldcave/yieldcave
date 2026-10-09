// Plans and allowances. Pure functions; the hosted endpoint enforces them, local servers ignore them.
export const PLANS = {
  anonymous: { name: 'Anonymous', price: '$0', callsPerDay: 200, alerts: 0, how: 'No key. Limit is per IP address per UTC day.' },
  free: { name: 'Free', price: '$0', callsPerDay: 1000, alerts: 3, how: 'Already have a key? Send it as an x-api-key header (or Authorization: Bearer). On claude.ai, which cannot send headers, edit the connector URL to end with ?key=<your key>. No key yet? Call create_api_key with your email; it is free and shown once.' },
  pro: { name: 'Pro', price: '$49/month', callsPerDay: 5000, alerts: 100, how: 'Call upgrade with your key to get a checkout link.' },
};

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
    return tier === 'anonymous'
      ? `Daily limit reached (${plan.callsPerDay} calls per IP on the ${plan.name} plan). Create a free API key with create_api_key for ${PLANS.free.callsPerDay} calls per day.`
      : tier === 'free'
        ? `Daily limit reached (${plan.callsPerDay} calls on the Free plan). Call upgrade for Pro (${PLANS.pro.callsPerDay} calls per day, ${PLANS.pro.price}).`
        : `Daily limit reached (${plan.callsPerDay} calls on the Pro plan). Contact support to raise it.`;
  }
  return tier === 'anonymous'
    ? 'Alerts need an API key. Call create_api_key with your email (free).'
    : `Alert limit reached (${plan.alerts} on the ${plan.name} plan).${tier === 'free' ? ' Call upgrade for Pro (100 alerts).' : ''}`;
}

export const KEY_TOOLS = new Set(['create_alert', 'list_alerts', 'delete_alert', 'my_usage', 'upgrade', 'manage_subscription']);
