#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

env_file="$root_dir/.env.local"
if [[ ! -f "$env_file" ]]; then
  echo "Missing .env.local. Create it locally with LIB_PASSWORD and LIB_BASE_URL." >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  if [[ -z "$line" || "$line" == \#* ]]; then
    continue
  fi
  if [[ "$line" == export\ * ]]; then
    line="${line#export }"
    line="${line#"${line%%[![:space:]]*}"}"
  fi

  if [[ "$line" =~ ^([^=[:space:]]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
    name="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    if [[ ( "$value" == \"*\" && "$value" == *\" ) || ( "$value" == \'*\' && "$value" == *\' ) ]]; then
      value="${value:1:${#value}-2}"
    fi
    export "$name=$value"
  fi
done < "$env_file"

if [[ -z "${LIB_PASSWORD:-}" ]]; then
  echo "LIB_PASSWORD is required." >&2
  exit 1
fi

if [[ -z "${LIB_BASE_URL:-}" ]]; then
  echo "LIB_BASE_URL is required." >&2
  exit 1
fi

if [[ "${LIB_BASE_URL}" != */ ]]; then
  echo "LIB_BASE_URL must end with '/'." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found in PATH." >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI not found in PATH." >&2
  exit 1
fi

node tools/build-library.mjs

path="${LIB_BASE_URL#*://}"
if [[ "$path" == */* ]]; then
  path="${path#*/}"
else
  path=""
fi
path="${path#/}"
path="${path%/}"

if [[ -z "$path" ]]; then
  echo "LIB_BASE_URL must include a bucket path." >&2
  exit 1
fi

bucket="${path%%/*}"
prefix=""
if [[ "$path" == */* ]]; then
  prefix="${path#*/}"
fi

if [[ -n "$prefix" ]]; then
  dest="s3://${bucket}/${prefix}/"
else
  dest="s3://${bucket}/"
fi

aws --endpoint-url=https://storage.yandexcloud.net s3 sync out/objects "$dest"
