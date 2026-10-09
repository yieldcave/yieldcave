#!/usr/bin/env bash
# Publish site/*.html to https://yieldcave.com (Cloudflare). One-time setup: npx wrangler login
#   ./scripts/publish-site.sh
set -euo pipefail
cd "$(dirname "$0")/.."
npx -y wrangler@latest pages deploy site --project-name yieldcave
echo "Live at https://yieldcave.com (the edge cache can take a minute to refresh)"
