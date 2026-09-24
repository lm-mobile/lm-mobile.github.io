#!/usr/bin/env bash
# Embeds lm-mobile.js into worker.template.js and writes worker.js
# (the single file you paste into Cloudflare, or that Cloudflare deploys from GitHub).
set -euo pipefail
cd "$(dirname "$0")"
if grep -qE '`|\$\{' lm-mobile.js; then
  echo "lm-mobile.js must not contain backticks or a dollar sign followed by a brace" >&2
  exit 1
fi
sed -e '/\/\*__LOADER__\*\//{r lm-mobile.js' -e 'd}' worker.template.js > worker.js
echo "wrote worker.js ($(wc -c < worker.js) bytes)"
