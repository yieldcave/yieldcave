#!/usr/bin/env bash
# One-time Stripe setup. Run from the project folder once you have a Stripe account:
#   ./scripts/configure-stripe.sh sk_live_... price_... whsec_...
# 1. In Stripe: Products → Add product "YieldCave Pro", recurring $49/month → copy the price id (price_...).
# 2. In Stripe: Developers → Webhooks → Add endpoint:
#      https://ccvhvxbqtvqbhexhrjnj.supabase.co/functions/v1/stripe-webhook
#    events: checkout.session.completed, customer.subscription.deleted, customer.subscription.updated → copy the signing secret (whsec_...).
# 3. Developers → API keys → copy the secret key (sk_live_... or sk_test_... to try it first).
set -euo pipefail
if [ $# -ne 3 ]; then echo "usage: $0 <STRIPE_SECRET_KEY> <STRIPE_PRICE_ID> <STRIPE_WEBHOOK_SECRET>"; exit 2; fi
supabase secrets set STRIPE_SECRET_KEY="$1" STRIPE_PRICE_ID="$2" STRIPE_WEBHOOK_SECRET="$3"
supabase functions deploy stripe-webhook --no-verify-jwt --use-api
echo "Done. Test it: ask Claude (with your API key set) to call the 'upgrade' tool; it should return a checkout URL."
