#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root_dir"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found in PATH." >&2
  exit 1
fi

node tools/admin-panel/server.mjs
