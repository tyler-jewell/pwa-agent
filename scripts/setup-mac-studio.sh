#!/usr/bin/env bash
# Sole greenfield Mac Studio entry: install Rust if needed, build msa, run setup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v rustc >/dev/null 2>&1 || ! command -v cargo >/dev/null 2>&1; then
  echo "Installing Rust toolchain (rustup)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "${HOME}/.cargo/env"
fi

# shellcheck disable=SC1091
[ -f "${HOME}/.cargo/env" ] && source "${HOME}/.cargo/env"

echo "Building and installing msa…"
cargo install --path crates/msa --force

PARENT_ARGS=()
if [ -n "${MSA_AGENT_PASSWORD:-}" ]; then
  PARENT_ARGS+=(--password "$MSA_AGENT_PASSWORD")
fi

echo "Running msa setup ${PARENT_ARGS[*]:-} $*…"
exec msa setup "${PARENT_ARGS[@]}" "$@"
