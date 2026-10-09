// Stripe event handling, kept pure so it can be unit-tested in Node. `db` is a supabase-js client (or a fake).
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

export function tierForSubscriptionEvent(type, status) {
  if (type === 'customer.subscription.deleted') return 'free';
  if (type === 'customer.subscription.updated') return ACTIVE.has(status) ? 'pro' : 'free';
  return null;
}

export async function applyStripeEvent(event, db) {
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    if (!s.client_reference_id) return { action: 'ignored', reason: 'no client_reference_id' };
    await db.from('api_keys').update({ tier: 'pro', stripe_customer_id: String(s.customer ?? ''), stripe_subscription_id: String(s.subscription ?? '') }).eq('id', s.client_reference_id);
    return { action: 'upgraded', keyId: s.client_reference_id };
  }
  const tier = tierForSubscriptionEvent(event.type, event.data?.object?.status);
  if (!tier) return { action: 'ignored', reason: `unhandled event ${event.type}` };
  const sub = event.data.object;
  await db.from('api_keys').update({ tier }).eq('stripe_subscription_id', sub.id);
  return { action: tier === 'pro' ? 'kept-pro' : 'downgraded', subscriptionId: sub.id };
}

// Full webhook handling: verify the Stripe signature, then apply the event. Returns { status, body } for the HTTP layer.
// `stripe` is a Stripe SDK instance; `cryptoProvider` is optional (Deno needs Stripe.createSubtleCryptoProvider()).
export async function handleStripeWebhook({ stripe, rawBody, signature, secret, db, cryptoProvider }) {
  if (!secret) return { status: 503, body: { error: 'stripe not configured' } };
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature ?? '', secret, undefined, cryptoProvider);
  } catch (e) {
    return { status: 400, body: { error: `bad signature: ${e.message}` } };
  }
  const outcome = await applyStripeEvent(event, db);
  return { status: 200, body: { received: true, ...outcome } };
}
