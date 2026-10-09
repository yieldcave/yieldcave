// Stripe webhook: upgrades a key to Pro when checkout completes, downgrades when the subscription ends.
// Register https://<project-ref>.supabase.co/functions/v1/stripe-webhook in Stripe with events:
//   checkout.session.completed, customer.subscription.deleted, customer.subscription.updated
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { handleStripeWebhook } from '../_shared/billing.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const sk = Deno.env.get('STRIPE_SECRET_KEY');
  if (!sk) return new Response('stripe not configured', { status: 503 });
  const stripe = new Stripe(sk, { apiVersion: '2025-02-24.acacia' as never });
  const { status, body } = await handleStripeWebhook({
    stripe, rawBody: await req.text(), signature: req.headers.get('stripe-signature'), secret: Deno.env.get('STRIPE_WEBHOOK_SECRET'), db,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  });
  return Response.json(body, { status });
});
