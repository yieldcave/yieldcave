// Stripe event handling, kept pure so it can be unit-tested in Node. `db` is a supabase-js client (or a fake).
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

export const tierForStatus = (status) => (ACTIVE.has(status) ? 'pro' : 'free');

export function tierForSubscriptionEvent(type, status) {
  if (type === 'customer.subscription.deleted') return 'free';
  if (type === 'customer.subscription.updated') return tierForStatus(status);
  return null;
}

// Sets the tier for the key holding a subscription id. Returns how many rows matched (0 means the id is unknown to us).
async function setTierBySubscription(db, subscriptionId, tier) {
  const { data, error } = await db.from('api_keys').update({ tier }).eq('stripe_subscription_id', subscriptionId).select('id');
  if (error) throw new Error(`database: ${error.message}`);
  return (data ?? []).length;
}

// `fetchSubscription(id)` returns Stripe's current view of the subscription ({ id, status, customer }) or null.
// Stripe does not guarantee event order, so the live status wins over whatever the event payload says.
export async function applyStripeEvent(event, db, { fetchSubscription = null } = {}) {
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    if (!s.client_reference_id) return { action: 'ignored', reason: 'no client_reference_id' };
    const { data, error } = await db.from('api_keys').update({ tier: 'pro', stripe_customer_id: String(s.customer ?? ''), stripe_subscription_id: String(s.subscription ?? '') }).eq('id', s.client_reference_id).select('id');
    if (error) throw new Error(`database: ${error.message}`);
    return { action: 'upgraded', keyId: s.client_reference_id, matched: (data ?? []).length };
  }
  const payloadTier = tierForSubscriptionEvent(event.type, event.data?.object?.status);
  if (!payloadTier) return { action: 'ignored', reason: `unhandled event ${event.type}` };
  const sub = event.data.object;
  let tier = payloadTier;
  let source = 'event';
  if (fetchSubscription) {
    const live = await fetchSubscription(sub.id);
    if (live) { tier = tierForStatus(live.status); source = `stripe:${live.status}`; }
  }
  const matched = await setTierBySubscription(db, sub.id, tier);
  return { action: tier === 'pro' ? 'kept-pro' : 'downgraded', subscriptionId: sub.id, matched, source };
}

// Re-read one subscription from Stripe and set the key's tier from it. Used to repair a row by hand.
export async function resyncSubscription(subscriptionId, db, fetchSubscription) {
  const live = await fetchSubscription(subscriptionId);
  if (!live) return { subscriptionId, found: false };
  const tier = tierForStatus(live.status);
  const matched = await setTierBySubscription(db, subscriptionId, tier);
  return { subscriptionId, found: true, status: live.status, cancelAtPeriodEnd: live.cancel_at_period_end ?? null, tier, matched };
}

// Full webhook handling: verify the Stripe signature, then apply the event. Returns { status, body } for the HTTP layer.
export async function handleStripeWebhook({ stripe, rawBody, signature, secret, db, cryptoProvider, fetchSubscription = null, log = null }) {
  if (!secret) return { status: 503, body: { error: 'stripe not configured' } };
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature ?? '', secret, undefined, cryptoProvider);
  } catch (e) {
    return { status: 400, body: { error: `bad signature: ${e.message}` } };
  }
  const outcome = await applyStripeEvent(event, db, { fetchSubscription });
  if (log) await log({ event_id: event.id, type: event.type, subscription_id: event.data?.object?.subscription ?? event.data?.object?.id ?? null, payload_status: event.data?.object?.status ?? null, outcome });
  return { status: 200, body: { received: true, ...outcome } };
}
