#!/usr/bin/env bash
# Set a Stripe secret on Supabase straight from the clipboard, so it is never typed or pasted into the shell.
#   API secret key (sk_/rk_)      -> STRIPE_SECRET_KEY
#   Webhook signing secret (whsec_) -> STRIPE_WEBHOOK_SECRET
# Usage: click Copy in Stripe, then run: ./scripts/set-stripe-key.sh
set -euo pipefail
cd "$(dirname "$0")/.."
val="$(pbpaste | tr -d '[:space:]')"
case "$val" in
  sk_live_*|rk_live_*|sk_test_*|rk_test_*) name=STRIPE_SECRET_KEY ;;
  whsec_*) name=STRIPE_WEBHOOK_SECRET ;;
  *) echo "Clipboard does not hold a Stripe secret key or webhook signing secret (it starts with '${val:0:8}'). Copy it in Stripe and run this again."; exit 1 ;;
esac
supabase secrets set "$name=$val" --project-ref ccvhvxbqtvqbhexhrjnj >/dev/null
echo "Set $name (${val:0:8}...${val: -4}). Fingerprint: $(printf %s "$val" | shasum -a 256 | cut -c1-8)"
