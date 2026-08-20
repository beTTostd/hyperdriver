#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"

command -v timeout || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

next="${project_root}/node_modules/.bin/next"
if [[ ! -x "${next}" ]]; then
  echo "Next.js is unavailable. Run npm run install:ci before building." >&2
  exit 69
fi

cd "${project_root}"
echo "Running bounded Next.js build with webpack..."
timeout \
  --signal=TERM \
  --kill-after="${NEXT_BUILD_KILL_AFTER:-10s}" \
  "${NEXT_BUILD_TIMEOUT:-3m}" \
  "${next}" build --webpack

"${script_dir}/validate-artifact.sh"
