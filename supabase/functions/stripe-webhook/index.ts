// Stripe webhook: upgrades a key to Pro when checkout completes, downgrades when the subscription ends.
// Tier changes read the subscription's CURRENT status from Stripe (events can arrive out of order).
// Every event is logged to billing_events. GET ?resync=<subscription_id> with the x-refresh-secret header repairs one row.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { handleStripeWebhook, resyncSubscription } from '../_shared/billing.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const sk = Deno.env.get('STRIPE_SECRET_KEY');
  if (!sk) return new Response('stripe not configured', { status: 503 });
  const stripe = new Stripe(sk, { apiVersion: '2025-02-24.acacia' as never });
  const fetchSubscription = async (id: string) => {
    try { const s = await stripe.subscriptions.retrieve(id); return { id: s.id, status: s.status, customer: String(s.customer), cancel_at_period_end: s.cancel_at_period_end }; }
    catch { return null; }
  };
  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('resync')) {
    const secret = Deno.env.get('REFRESH_SECRET');
    if (!secret || req.headers.get('x-refresh-secret') !== secret) return new Response('unauthorized', { status: 401 });
    const out = await resyncSubscription(url.searchParams.get('resync')!, db, fetchSubscription);
    await db.from('billing_events').insert({ type: 'manual.resync', subscription_id: out.subscriptionId, payload_status: out.status ?? null, outcome: out });
    return Response.json(out);
  }
  const { status, body } = await handleStripeWebhook({
    stripe, rawBody: await req.text(), signature: req.headers.get('stripe-signature'), secret: Deno.env.get('STRIPE_WEBHOOK_SECRET'), db,
    cryptoProvider: Stripe.createSubtleCryptoProvider(), fetchSubscription,
    log: async (row) => { await db.from('billing_events').insert(row); },
  });
  return Response.json(body, { status });
});
