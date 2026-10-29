#!/bin/sh
# Runs every test. Needs Node 18+, Python 3 and a Chromium (set CHROME_PATH if Playwright cannot find one).
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
mkdir -p out
python3 ../src/build.py https://relay.test/exec test-client-id.apps.googleusercontent.com test_index.html > /dev/null
node unit_core.js
(cd ../relay && node test_relay.js | tail -1)
for t in e2e_roles e2e_work e2e_session e2e_title e2e_privacy e2e_entry; do echo "== $t"; node "$t.js" | grep -v '^PASS' ; done
