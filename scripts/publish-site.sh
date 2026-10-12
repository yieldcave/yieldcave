#!/usr/bin/env bash
# Publish site/*.html to https://yieldcave.com (Cloudflare). One-time setup: npx wrangler login
#   ./scripts/publish-site.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# yieldcave.com is a Worker serving site/ as static assets (see wrangler.jsonc), not a Pages project.
npx wrangler deploy
echo "Live at https://yieldcave.com (the edge cache can take a minute to refresh)"
