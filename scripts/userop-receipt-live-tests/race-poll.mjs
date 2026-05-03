#!/usr/bin/env node
// Race-poll eth_getUserOperationReceipt against an arbitrary RPC URL,
// asserting zero HTTP 500 / -32020 / "valid timestamp range" lines.
//
// Used by:
//   - task-008 (mainnet rollout race test against https://rpc.goliath.net/)
//   - task-009 (mainnet bridge-then-stake reproduction)
//   - task-010 step 4 testnet template (race-poll-testnet-template.sh) — runs
//     the moment testnet relay exposes eth_getUserOperationReceipt
//
// Usage:
//   node race-poll.mjs <userOpHash> <rpcUrl> <outFile>
//   node race-poll.mjs 0xabc... https://rpc.goliath.net/ ./race-poll.jsonl
//
// Behavior:
//   - polls every POLL_INTERVAL_MS for up to MAX_POLL_MS
//   - writes one JSON-Lines record per probe with timestamp, status, body
//   - prints a final summary asserting:
//       zero HTTP 500
//       zero JSON-RPC -32020
//       zero "valid timestamp range" message text
//       first 200/null observed within FIRST_NULL_BUDGET_MS
//       first 200/receipt observed within FIRST_RECEIPT_BUDGET_MS
//   - exits 0 only if all assertions hold; non-zero otherwise

import { writeFileSync, appendFileSync } from 'node:fs';

const POLL_INTERVAL_MS = 250;
const MAX_POLL_MS = 60_000;
const FIRST_NULL_BUDGET_MS = 1500;
const FIRST_RECEIPT_BUDGET_MS = 15_000;

const [, , userOpHash, rpcUrl, outFile] = process.argv;

if (!userOpHash || !rpcUrl || !outFile) {
  console.error('Usage: node race-poll.mjs <userOpHash> <rpcUrl> <outFile>');
  process.exit(2);
}

if (!/^0x[0-9a-fA-F]{64}$/.test(userOpHash)) {
  console.error(`Invalid userOpHash: ${userOpHash}`);
  process.exit(2);
}

writeFileSync(outFile, '');

const startedAt = Date.now();
let firstNullAt = null;
let firstReceiptAt = null;
let any500 = false;
let any32020 = false;
let anyValidTimestampRange = false;
let probeCount = 0;

while (Date.now() - startedAt < MAX_POLL_MS) {
  const probeStartedAt = Date.now();
  let httpStatus = -1;
  let body = null;
  let raw = null;
  let error = null;
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getUserOperationReceipt',
        params: [userOpHash],
        id: probeCount + 1,
      }),
    });
    httpStatus = res.status;
    raw = await res.text();
    try {
      body = JSON.parse(raw);
    } catch {
      body = { __unparsedBody: raw };
    }
  } catch (e) {
    error = e?.message || String(e);
  }

  probeCount += 1;

  const tElapsedMs = Date.now() - startedAt;
  const probeDurationMs = Date.now() - probeStartedAt;

  const record = {
    probeIndex: probeCount,
    elapsedMs: tElapsedMs,
    durationMs: probeDurationMs,
    httpStatus,
    body,
    error,
  };
  appendFileSync(outFile, JSON.stringify(record) + '\n');

  if (httpStatus === 500) any500 = true;
  if (body?.error?.code === -32020) any32020 = true;
  const messageText = `${body?.error?.message ?? ''} ${raw ?? ''}`;
  if (/valid timestamp range/i.test(messageText)) anyValidTimestampRange = true;

  if (httpStatus === 200 && body?.result === null && firstNullAt === null) {
    firstNullAt = tElapsedMs;
  }
  if (httpStatus === 200 && body?.result && firstReceiptAt === null) {
    firstReceiptAt = tElapsedMs;
    break;
  }

  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}

const summary = {
  userOpHash,
  rpcUrl,
  outFile,
  probeCount,
  totalElapsedMs: Date.now() - startedAt,
  firstNullAtMs: firstNullAt,
  firstReceiptAtMs: firstReceiptAt,
  any500,
  any32020,
  anyValidTimestampRange,
  passed:
    !any500 &&
    !any32020 &&
    !anyValidTimestampRange &&
    firstNullAt !== null &&
    firstNullAt <= FIRST_NULL_BUDGET_MS &&
    firstReceiptAt !== null &&
    firstReceiptAt <= FIRST_RECEIPT_BUDGET_MS,
  budgetFirstNullMs: FIRST_NULL_BUDGET_MS,
  budgetFirstReceiptMs: FIRST_RECEIPT_BUDGET_MS,
};

const summaryPath = outFile.replace(/\.jsonl?$/, '.summary.json');
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.passed ? 0 : 1);
