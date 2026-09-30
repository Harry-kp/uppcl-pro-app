#!/usr/bin/env bash
# Fail if the tree contains tokens or personal data. Generic patterns are below; the maintainer's own
# identifiers come from the PII_PATTERNS env var (one fixed string per line; a CI secret), so they are
# never written into this public repo.
set -euo pipefail
cd "$(dirname "$0")/.."
ex=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=android --exclude-dir=ios --exclude-dir=.expo --exclude=bun.lock)
bad=0
# JWTs (header.payload), and personal mail addresses
if grep -rInE "${ex[@]}" 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|[A-Za-z0-9._%+-]+@gmail\.com' .; then bad=1; fi
if [ -n "${PII_PATTERNS:-}" ]; then
  if grep -rIlF "${ex[@]}" -f <(printf '%s\n' "$PII_PATTERNS" | sed '/^$/d') .; then bad=1; fi
else
  echo "PII_PATTERNS not set: personal-identifier scan skipped (generic scan only)" >&2
fi
[ "$bad" = 0 ] && echo "PII scan clean" || { echo "PII scan: matches above" >&2; exit 1; }
