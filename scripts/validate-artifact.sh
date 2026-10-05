#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
server="${project_root}/.next/standalone/server.js"
build_id="${project_root}/.next/BUILD_ID"
static_dir="${project_root}/.next/static"

[[ -f "${server}" ]] || {
  echo "Missing standalone Next.js server: .next/standalone/server.js" >&2
  exit 66
}
[[ -s "${build_id}" ]] || {
  echo "Missing Next.js build identifier: .next/BUILD_ID" >&2
  exit 66
}
[[ -d "${static_dir}" ]] || {
  echo "Missing Next.js static assets: .next/static" >&2
  exit 66
}

for analysis_file in decision-analysis-process.mjs decision-analysis-core.js decision-card-catalog.js decision-turn-search.js decision-opponent-knowledge.js decision-opponent-model.js decision-information-search.js decision-learning.js; do
  [[ -f "${project_root}/.next/standalone/lib/${analysis_file}" ]] || {
    echo "Missing standalone analysis worker dependency: ${analysis_file}" >&2
    exit 66
  }
done

echo "Validated standalone Next.js artifact."
