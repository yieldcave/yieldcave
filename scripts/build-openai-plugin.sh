#!/usr/bin/env bash
# Build the ChatGPT plugin ZIP for upload at platform.openai.com/plugins.
# Usage: ./scripts/build-openai-plugin.sh https://www.loom.com/share/...   (the reviewer demo video URL)
set -euo pipefail
cd "$(dirname "$0")/.."
url="${1:?Pass the demo video URL (Loom or unlisted YouTube) as the first argument}"
case "$url" in https://*) ;; *) echo "The demo URL must start with https://"; exit 1 ;; esac
out="$PWD/yieldcave-openai-plugin.zip"
tmp="$(mktemp -d)"
cp -R openai-plugin/. "$tmp/"
python3 - "$tmp/plugin.json" "$url" <<'PY'
import json, sys
p, url = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d["extensions"]["com.openai"]["review"]["demo_recording_url"] = url
json.dump(d, open(p, "w"), indent=2)
PY
rm -f "$out"; (cd "$tmp" && zip -qr "$out" plugin.json mcp.json assets)
rm -rf "$tmp"
echo "Built $out"
