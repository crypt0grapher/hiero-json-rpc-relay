# Redesign Consensus-Authoritative Nonce Reads

**Project:** Goliath JSON-RPC Relay
**Type:** Bug Fix | Performance | Integration
**Priority:** P1
**Risk level:** High
**Requires deployment?:** Yes
**Requires network freeze?:** No
**Owner:** Goliath Engineering
**Date created:** 2026-04-09
**Related docs / prior issues:** `~/goliath/mainnet/docs/issues/2026-04-09-live-user-wrong-nonce-recurrence-after-latency-improvement.md`, `~/goliath/json-rpc-relay/docs/tasks/2026-03-30-relay-nonce-authority-and-simplification.md`, `packages/relay/src/lib/services/ethService/accountService/AccountService.ts`, `packages/relay/src/lib/precheck.ts`, `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts`

---

## Execution Update 2026-04-09 20:21 UTC

- Implemented the bounded consensus nonce helper in `AuthoritativeNonceService` with a new `ETH_GET_TRANSACTION_COUNT_CONSENSUS_TIMEOUT_MS` config knob defaulting to `1000ms`.
- The helper now keeps one underlying consensus lookup per account key while returning a bounded mirror fallback on timeout, so `latest`, `pending`, and precheck keep sharing the same source without reintroducing the old unbounded wait path.
- `precheck.ts` now returns the shared snapshot metadata (`consensusNonce`, `mirrorNonce`, `source`) and `TransactionService.ts` logs those fields on `WRONG_NONCE` so the FRA canary can distinguish authoritative reads from bounded fallback.
- Added direct relay coverage in `packages/relay/tests/lib/services/ethService/accountService/AuthoritativeNonceService.spec.ts` and new precheck snapshot assertions in `packages/relay/tests/lib/precheck.spec.ts`.
- Verified locally:
  - `cd ~/goliath/json-rpc-relay/packages/config-service && npm run build`
  - `cd ~/goliath/json-rpc-relay/packages/relay && npx ts-mocha ./tests/lib/services/ethService/accountService/AuthoritativeNonceService.spec.ts ./tests/lib/precheck.spec.ts --exit`
  - `cd ~/goliath/json-rpc-relay/packages/relay && npx ts-mocha ./tests/lib/eth/eth_getTransactionCount.spec.ts ./tests/lib/eth/eth_sendRawTransaction.spec.ts --exit -g 'eth_getTransactionCount|WRONG_NONCE'`
  - `cd ~/goliath/json-rpc-relay && npm run build`
- Note: a broader grep run of `npm run test -- -g 'eth_getTransactionCount|WRONG_NONCE'` also matched unrelated `eth_getBlockByNumber` fixture coverage and failed on missing contract-results mocks outside this relay nonce path.

---

## 1) GOAL / SUCCESS CRITERIA

**What "done" means**

Relay can return the consensus-correct nonce for affected EOAs without reproducing the failed FRA canary behavior where cache-miss `eth_getTransactionCount` calls stalled for roughly `10s`.

**Must-have outcomes**

- [x] `eth_getTransactionCount(latest)` and `pending` can use the same consensus snapshot for affected EOAs
- [x] Stateful precheck reuses the same source so send and query paths stop disagreeing
- [x] Cache miss behavior is bounded and observable instead of waiting through the old long path
- [ ] FRA canary proves a correctness win or produces a crisp rollback decision

**Acceptance criteria (TDD)**

- [x] Test A: consensus-ahead and mirror-ahead cases are covered by unit tests using the shared helper
- [x] Test B: `pending` returns `consensusNonce + txPoolPendingCount` from the same snapshot
- [x] Test C: timeout/fallback behavior is covered and does not wait through the old `~10s` path
- [x] Test D: build and targeted tests pass
- [ ] Test E: FRA canary no longer shows the earlier `~10s` cache-miss spikes

**Non-goals**

- Do not make the relay the permanent source of truth if the importer fix removes the need
- Do not widen rollout past FRA until the latency gate passes
- Do not rely on `ENABLE_NONCE_ORDERING` as the primary fix

---

## 2) ENVIRONMENT

### Project Details

- **Repository path:** `~/goliath/json-rpc-relay`
- **Language/stack:** TypeScript / Node.js
- **Relevant files:**
  - `packages/relay/src/lib/services/ethService/accountService/AccountService.ts`
  - `packages/relay/src/lib/precheck.ts`
  - `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts`
  - `packages/relay/tests/`
- **Build command:** `npm run build`
- **Focused test command:** `cd packages/relay && npm run test -- -g 'eth_getTransactionCount|WRONG_NONCE'`

### Deployment Details

- **Mainnet namespace:** `goliath-relay`
- **Primary canary target:** FRA `relay-http`
- **Current production image:** `d62b985`

---

## 3) CONSTRAINTS

### Hard Safety Constraints

- [ ] Do NOT expose operator keys, kubeconfigs, or secrets in task output
- [ ] Do NOT roll out beyond FRA until the canary passes
- [ ] Do NOT accept a design that repeats the old `~10s` cache-miss behavior

### Code Constraints

- [ ] Use one shared helper for query and precheck semantics; do not let the paths drift again
- [ ] Bound cache miss behavior with timeout/coalescing instead of unbounded waits
- [ ] Keep contract or non-EOA edge cases explicit; use `TO VERIFY` where needed rather than guessing

---

## 4) TASK ANALYSIS

### 4.1 Symptoms

- Fresh live sender `0x6541cF...` / `0.0.2061` still saw public `latest=320`, `pending=320`, while consensus expected `319`
- The first consensus-authoritative canary was directionally correct but operationally unsafe: cache-miss `eth_getTransactionCount` calls spiked to roughly `10s`
- Production therefore reverted to the hotfix-only image, which classifies the error correctly but still returns the wrong nonce source

### 4.2 Impact

- Wallets keep reading the mirror nonce even when consensus expects a lower one
- Users remain blocked even though relay now emits a cleaner `nonce conflict` payload
- The durable importer fix may take longer than a relay read-path fix, so users still need a safe near-term mitigation

### 4.3 Affected Code

| File | Function / Component | Issue |
|---|---|---|
| `packages/relay/src/lib/services/ethService/accountService/AccountService.ts` | `eth_getTransactionCount` path | Needs a bounded-latency consensus nonce source |
| `packages/relay/src/lib/precheck.ts` | stateful precheck | Must reuse the same nonce snapshot as `eth_getTransactionCount` |
| `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts` | nonce-conflict telemetry | Should log both mirror and consensus context from the same helper when available |

---

## 5) ROOT CAUSE ANALYSIS

### 5.1 Root Cause

The relay still trusts mirror-derived nonce reads in production because the first consensus-authoritative implementation blocked too long on cache misses and had to be rolled back.

### 5.2 Contributing Factors

- The earlier canary did not bound miss-time behavior tightly enough
- Query and send/precheck logic need to stay on one nonce source or they will drift again
- The immediate user-facing fix must coexist with the still-open importer source-of-truth bug

---

## 6) SOLUTIONS (compare options)

### Option A - Direct consensus lookup on every request

**Pros**

- Simplest mental model

**Cons**

- Already failed operationally in FRA due to long cache-miss latency
- Too expensive for the hot path as previously implemented

### Option B - Bounded-latency read-through helper with coalescing and fallback

**Changes required**

- Add a shared consensus nonce helper
- Bound miss-time behavior with timeout/coalescing
- Reuse the same snapshot in `latest`, `pending`, and precheck
- Log fallback events explicitly

**Pros**

- Preserves correctness where available without repeating the earlier long stalls
- Gives operators observability into when relay had to fall back
- Can be rolled back independently of the importer fix

**Cons**

- More moving parts than a naive direct lookup
- Still a temporary read-path mitigation if the importer fix lands quickly

### Recommended option

**Option B**

Reason: it is the only relay path that can plausibly fix user-facing reads without repeating the already-failed FRA canary behavior.

---

## 7) IMPLEMENTATION PLAN

1. Inspect the failed canary code path and identify where the long miss-time wait came from.
   - Expected output: one concrete bottleneck to eliminate
   - Failure modes: multiple contributors require instrumented retry
   - Rollback: none; read-only

2. Implement a shared consensus nonce helper with timeout, request coalescing, and explicit fallback logging.
   - Expected output: one helper reused by `latest`, `pending`, and precheck
   - Failure modes: path-specific regressions if one caller bypasses the helper
   - Rollback: revert only the new helper commit

3. Add targeted tests for consensus-ahead, mirror-ahead, cache hit, cache miss, and timeout fallback behavior.
   - Expected output: failing tests before the fix, passing after
   - Failure modes: brittle mocks for SDK client behavior
   - Rollback: revert only the new test fixtures if they need rework

4. Build the relay and produce one FRA canary image.
   - Command: `cd packages/relay && npm run test -- -g 'eth_getTransactionCount|WRONG_NONCE'` then `cd ~/goliath/json-rpc-relay && npm run build`
   - Expected output: build passes and candidate image digest is recorded
   - Failure modes: unrelated pre-existing test failures
   - Rollback: keep the current production image

5. Hand off the image to mainnet for FRA-only canary.
   - Expected output: one candidate digest plus the exact log/metric checks to watch
   - Failure modes: missing observability makes the canary inconclusive
   - Rollback: keep `d62b985` live
