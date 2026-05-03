#!/usr/bin/env bash
# Goliath testnet — race-poll eth_getUserOperationReceipt template.
# When testnet relay gets eth_getUserOperationReceipt, run:
#   ./race-poll-testnet-template.sh <userOpHash>
# Mirrors task-008 mainnet race-poll, no other changes needed.
#
# Today (2026-05-03) testnet returns -32601 method-not-found, so this script
# will report `passed: false` with a clear hint until the method ships there.
# That hint IS the regression signal — it is the testnet equivalent of the
# fix proven on mainnet by task-008.

set -euo pipefail

HASH="${1:?userOpHash required}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
OUT_DIR="${SCRIPT_DIR}/../../packages/relay/tests/fixtures/userop-receipt-live-testnet-${STAMP}"

mkdir -p "${OUT_DIR}"
echo "${HASH}" > "${OUT_DIR}/hash.txt"

node "${SCRIPT_DIR}/race-poll.mjs" \
  "${HASH}" \
  https://rpc.testnet.goliath.net/ \
  "${OUT_DIR}/race-poll.jsonl"
