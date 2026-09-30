#!/usr/bin/env bash
# Remove the dev test-scenario tools entirely: the src/dev folder and every line tagged
# "@dev-tools" (the one-line hooks in main code). Then typecheck to prove the app still builds.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf src/dev
grep -rl "@dev-tools" app src shared | while read -r f; do
  sed -i.bak '/@dev-tools/d' "$f" && rm -f "$f.bak"
done
if grep -rn "@dev-tools\|src/dev" app src shared; then echo "leftover references above" >&2; exit 1; fi
bunx tsc --noEmit && echo "dev tools removed; app typechecks"
