# baseFeePerGas Uses Current Gas Price Instead of Historical Block-Time Gas Price

**Project:** json-rpc-relay
**Type:** Code Bug
**Priority:** P2
**Risk level:** Medium
**Requires deployment?:** Yes
**Requires network freeze?:** No
**Owner:** Goliath Engineering
**Status:** Code complete (uncommitted) — Blockscout normalized, fix 2 pending commit+deploy
**Date created:** 2026-02-10
**Related docs / prior issues:**
- Parent issue: [`docs/issues/2026-02-10-maxFeePerGas-Tinybar-Unit-Mismatch.md`](./2026-02-10-maxFeePerGas-Tinybar-Unit-Mismatch.md) (fix-4901)
- Discovered during Phase 6 (Live Validation) deployment of the maxFeePerGas tinybar-to-weibar fix

---

## 1) GOAL / SUCCESS CRITERIA

**What "fixed" means:**

`baseFeePerGas` in block responses reflects the gas price at the block's actual timestamp, not the current network gas price. This eliminates the scenario where Blockscout computes negative priority fees for historical transactions.

**Must-have outcomes**

- [ ] `blockWorker.ts` calls `getGasPriceInWeibars(requestDetails, blockTimestamp)` instead of `gasPrice(requestDetails)` when computing `baseFeePerGas`
- [ ] Unit tests assert that `baseFeePerGas` uses block-time gas price, not current gas price
- [ ] When gas prices change between blocks, each block's `baseFeePerGas` reflects its own timestamp's gas price
- [ ] Blockscout stats API shows gas prices consistent with `eth_gasPrice` (same order of magnitude, no negative priority)

**Acceptance criteria (TDD)**
Tests expected to fail before fix and pass after:

- [ ] Test A: Unit test in `blockWorker` tests — `baseFeePerGas` should use block timestamp, not current gas price
- [ ] Test B: When gas price changes between blocks, `baseFeePerGas` should reflect each block's actual gas price
- [ ] Test C: Blockscout stats API should show `gas_prices` consistent with `eth_gasPrice` (same order of magnitude)

**Non-goals**

- Not changing `eth_gasPrice` behavior (that correctly returns current gas price)
- Not changing `effectiveGasPrice` in receipts (that already uses block-time gas price)
- Not changing `eth_feeHistory` behavior
- Not modifying mirror node APIs

---

## 2) ENVIRONMENT

### Project Details

- **Repository path:** `/Users/alex/goliath/json-rpc-relay`
- **Language/stack:** TypeScript monorepo (npm workspaces + Lerna), Node 22
- **Entry points:** `packages/server/src/index.ts` (HTTP), `packages/ws-server/src/index.ts` (WS)
- **Build command:** `npm ci && npm run build`
- **Test command:** `cd packages/relay && npx ts-mocha --recursive './tests/**/*.spec.ts' --exit`
- **Lint/typecheck command:** `npm run lint && npm run build`

### Deployment Details

- **Kubernetes namespace:** `kubernetes`
- **Deployments:** `relay-1`, `relay-internal`, `relay-1-ws`, `relay-internal-ws`
- **Current image:** `ghcr.io/crypt0grapher/hiero-json-rpc-relay:0.75.0-fix-4901`

### Network Context

- Chain ID: `8901` (`0x22c5`)
- Network: Goliath Testnet
- Host: `104.238.187.163` (`lon`)

---

## 3) CONSTRAINTS

### Hard Safety Constraints

- [ ] Do not delete `.pces` files
- [ ] Do not flush iptables on remote servers
- [ ] Do not expose private keys, tokens, kubeconfigs, or credentials
- [ ] Do not perform consensus-affecting rolling restarts without explicit freeze gate
- [ ] Do not deploy contracts as part of this issue

### Code Change Constraints

- [ ] Scope change to `blockWorker.ts` gas price lookup and associated tests
- [ ] Preserve existing behavior for `eth_gasPrice` (current gas price is correct there)
- [ ] Preserve existing `effectiveGasPrice` behavior in receipts (already uses block timestamp)
- [ ] Use existing `getGasPriceInWeibars(requestDetails, timestamp)` pattern from `getCurrentGasPriceForBlock()`

### Operational Constraints

- Allowed downtime: none (rolling/canary rollout only)
- Blast radius: all RPC methods returning block objects with `baseFeePerGas`
- Freeze required?: no, unless deployment health degrades

---

## 4) ISSUE ANALYSIS

### 4.1 Symptoms

**Original symptoms (pre-fix-1):**
- **Blockscout display:** Base 14,359 / Priority -4,568 / Total 9,790.4 Gwei — negative priority fee
- **Blockscout stats API** (`https://testnet.explorer.goliath.net/api/v2/stats`): `gas_prices.average = 14,469 Gwei`
- **RPC `eth_gasPrice`:** Returns `16,470 Gwei` (current gas price = 1,647 tinybars)
- **RPC `baseFeePerGas` in blocks:** Also `16,470 Gwei` — uses current gas price, NOT block-time price
- **`feeHistory` rewards:** All `0x0` (no priority fees from relay)

The negative priority fee occurs because:
```
priorityFee = effectiveGasPrice - baseFeePerGas
priorityFee = 14,470 Gwei (historical) - 16,470 Gwei (current) = -2,000 Gwei
```

Blockscout computes `effectiveGasPrice - baseFeePerGas` for display. When gas prices have increased since a transaction was mined, the historical `effectiveGasPrice` is lower than the current-price-based `baseFeePerGas`, producing a negative priority fee.

**Current symptoms (post-fix-1, ~19:15 UTC):**
- **Blockscout:** NORMALIZED — `gas_prices` all showing ~16,180 Gwei (positive, converging upward)
- **baseFeePerGas drift:** Still varies 16,350-16,670 Gwei (1,635-1,667 tb) across blocks because deployed code uses current gas price at query time, not block-time price
- **Severity reduced:** Negative priority fees eliminated by fix 1 (maxFeePerGas conversion). Fix 2 addresses residual correctness issue (historical baseFeePerGas consistency).

### 4.2 Impact

- **User impact:** Blockscout and other explorers show negative/nonsensical gas prices for historical transactions, confusing users
- **System impact:** Any analytics or tooling that derives priority fee from `baseFeePerGas` and `effectiveGasPrice` will compute incorrect values
- **Scope:** All block-returning RPC methods: `eth_getBlockByHash`, `eth_getBlockByNumber`

### 4.3 Affected Code / Infra

| File | Function | Issue |
|------|----------|-------|
| `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts:321` | `getBlockByHashOrNumber()` | Uses `commonService.gasPrice()` (current) instead of block-time gas price |
| `packages/relay/src/lib/services/ethService/ethCommonService/CommonService.ts:521-528` | `gasPrice()` | Returns current gas price + buffer, used for `baseFeePerGas` in blocks |
| `packages/relay/src/lib/services/ethService/ethCommonService/CommonService.ts:614-620` | `getCurrentGasPriceForBlock()` | Returns block-time gas price — used for `effectiveGasPrice` in receipts (correct pattern) |

### 4.4 Evidence

**Current code in `blockWorker.ts` (line 321):**

```typescript
const gasPrice = await commonService.gasPrice(requestDetails);
```

`gasPrice()` calls `getGasPriceInWeibars(requestDetails)` WITHOUT a timestamp:

```typescript
// CommonService.ts line 521-528
public async gasPrice(requestDetails: RequestDetails): Promise<string> {
  try {
    const gasPrice = Utils.addPercentageBufferToGasPrice(await this.getGasPriceInWeibars(requestDetails));
    return numberTo0x(gasPrice);
  } catch (error) {
    throw this.genericErrorHandler(error, `Failed to retrieve gasPrice`);
  }
}
```

Compare with `getCurrentGasPriceForBlock()` which correctly uses block timestamp:

```typescript
// CommonService.ts line 614-620
public async getCurrentGasPriceForBlock(blockHash: string, requestDetails: RequestDetails): Promise<string> {
  const block = await this.mirrorNodeClient.getBlock(blockHash, requestDetails);
  const timestampDecimalString = block ? block.timestamp.from.split('.')[0] : '';
  const gasPriceForTimestamp = await this.getGasPriceInWeibars(requestDetails, timestampDecimalString);
  return numberTo0x(gasPriceForTimestamp);
}
```

Both ultimately call `getGasPriceInWeibars()`, but the block worker path omits the timestamp parameter:

```typescript
// CommonService.ts line 497
public async getGasPriceInWeibars(requestDetails: RequestDetails, timestamp?: string): Promise<number> {
  const networkFees = await this.mirrorNodeClient.getNetworkFees(requestDetails, timestamp, undefined);
  // ...
}
```

**Hedera gas price change evidence:**

The Hedera network gas price changed from approximately 1,447 tinybars to 1,647 tinybars at some point. Transactions mined at the old price have `effectiveGasPrice` of ~14,470 Gwei, but the relay reports `baseFeePerGas` of ~16,470 Gwei (current price) for those same blocks.

---

## 5) ROOT CAUSE ANALYSIS

### 5.1 Hypothesis

`blockWorker.ts` uses `commonService.gasPrice()` to set `baseFeePerGas` in block responses. This method returns the CURRENT network gas price (no timestamp). Meanwhile, `effectiveGasPrice` in transaction receipts uses `getCurrentGasPriceForBlock()` which passes the block's timestamp to `getGasPriceInWeibars()`. When Hedera gas prices change over time, these two values diverge, causing Blockscout to compute negative priority fees.

### 5.2 Supporting Evidence

1. `gasPrice()` at `CommonService.ts:521` calls `getGasPriceInWeibars(requestDetails)` — no timestamp, returns current price
2. `getCurrentGasPriceForBlock()` at `CommonService.ts:614` calls `getGasPriceInWeibars(requestDetails, timestampDecimalString)` — with timestamp, returns historical price
3. `blockWorker.ts:321` calls `commonService.gasPrice(requestDetails)` — gets current price for `baseFeePerGas`
4. The `blockResponse` object already contains `timestamp.from` at the point where `gasPrice` is called (line 276: `const timestampRange = blockResponse.timestamp`)
5. Live data confirms the divergence: `baseFeePerGas = 16,470 Gwei` (current) vs `effectiveGasPrice = 14,470 Gwei` (historical) for the same block

### 5.3 Gaps / TO VERIFY

- VERIFIED: `gasPrice()` calls `addPercentageBufferToGasPrice()` BUT `GAS_PRICE_PERCENTAGE_BUFFER` defaults to 0 — no practical difference from `getGasPriceInWeibars()` in current config
- TO VERIFY: Whether `eth_feeHistory` has the same current-vs-historical issue
- TO VERIFY: Whether the mirror node caches network fees by timestamp efficiently enough for this pattern

### 5.4 Root Cause (Final)

- **Root cause:** `blockWorker.ts:321` calls `commonService.gasPrice()` which returns the CURRENT network gas price (without timestamp). The result is used as `baseFeePerGas` for ALL blocks regardless of when they were produced. This creates a mismatch with `effectiveGasPrice` in receipts, which correctly uses the block's historical gas price.
- **Contributing factors:**
  - `gasPrice()` adds a percentage buffer (`addPercentageBufferToGasPrice`) which further inflates `baseFeePerGas` beyond the actual network fee
  - Hedera gas prices are not static — they change over time via HAPI fee schedule updates
  - The block response's `timestamp.from` is already available at line 276 but not used for the gas price lookup

---

## 6) SOLUTIONS (COMPARE OPTIONS)

### Option A — Use block timestamp for baseFeePerGas (Recommended)

**Changes required**

- `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts`: Extract the block's timestamp from `blockResponse` and pass it to `getGasPriceInWeibars()` instead of calling `gasPrice()`

```typescript
// Before (line 321):
const gasPrice = await commonService.gasPrice(requestDetails);

// After:
const blockTimestamp = blockResponse?.timestamp?.from?.split('.')[0] ?? '';
const gasPriceForBlock = await commonService.getGasPriceInWeibars(requestDetails, blockTimestamp);
const gasPrice = numberTo0x(gasPriceForBlock);
```

**Pros**

- Correct behavior — `baseFeePerGas` reflects actual gas price at block time
- Matches `effectiveGasPrice` for transactions in the same block
- Fixes Blockscout negative priority fee display
- Uses the same `getGasPriceInWeibars(requestDetails, timestamp)` pattern already used by `getCurrentGasPriceForBlock()`
- No percentage buffer inflation (uses raw gas price, not the buffered version from `gasPrice()`)

**Cons / risks**

- More mirror node queries for historical gas prices (but these are cached by the mirror node client)
- Slight behavior change for the `latest` block — `baseFeePerGas` will now be the exact network fee instead of the buffered fee (this is arguably more correct)

**Complexity:** Low
**Rollback:** Easy — revert single line change

### Option B — Use effectiveGasPrice from block transactions as baseFeePerGas

**Changes required**

- Derive `baseFeePerGas` from the `effectiveGasPrice` of transactions within the block
- Fall back to current gas price for empty blocks

**Pros**

- Perfectly consistent with transaction data in the same block
- No additional mirror node queries

**Cons / risks**

- Complex implementation — requires transaction data to be available when building block response
- Doesn't work for empty blocks (no transactions to derive from)
- Mixes concerns between block-level and transaction-level data

**Complexity:** High
**Rollback:** Moderate

### Decision

**Chosen option:** A
**Justification:** Minimal change with lowest risk. Matches the existing pattern used by `getCurrentGasPriceForBlock()`. Uses the same `getGasPriceInWeibars()` with timestamp parameter. The block timestamp is already available in `blockResponse.timestamp.from` at the point of the change.
**Accepted tradeoffs:** Additional mirror node query per block (mitigated by caching). `baseFeePerGas` for latest block will no longer include the percentage buffer added by `gasPrice()`.

---

## 7) DELIVERABLES

- [x] Issue document:
  - `docs/issues/2026-02-10-baseFeePerGas-Current-vs-Historical-Gas-Price.md`
- [ ] Code fix:
  - `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts` — use block timestamp for gas price lookup
- [ ] Tests:
  - `blockWorker` unit tests updated to assert block-time gas price for `baseFeePerGas`
  - Test covering gas price change between blocks
- [ ] Deployment:
  - Rebuild Docker image with updated `blockWorker.ts`
  - Canary rollout then full rollout
- [ ] Validation:
  - Blockscout stats API shows gas prices consistent with `eth_gasPrice`
  - No negative priority fees on new blocks
  - Historical blocks display correct `baseFeePerGas` for their timestamp

---

## 8) TDD: TESTS FIRST

### 8.1 Test Structure

- **Framework:** Mocha + Chai + Sinon
- **Unit tests:** blockWorker tests (or CommonService tests covering the gas price path)
- **Run command (targeted):**
  ```bash
  cd /Users/alex/goliath/json-rpc-relay/packages/relay
  npx ts-mocha --recursive './tests/**/*.spec.ts' -g 'baseFeePerGas' --exit
  ```

### 8.2 Required Tests

**Unit**

- [ ] Test A: When `getBlockByHashOrNumber()` is called for a historical block, `baseFeePerGas` should match the gas price at the block's timestamp (not the current gas price)
  - Stub `getGasPriceInWeibars()` to return different values for different timestamps
  - Assert `baseFeePerGas` in the returned block uses the block-timestamp value
- [ ] Test B: When gas price changes between blocks (e.g., block at t=1000 has price 1447 tinybars, block at t=2000 has price 1647 tinybars), each block's `baseFeePerGas` should reflect its own timestamp's gas price
  - Create two block responses with different timestamps
  - Stub `getGasPriceInWeibars()` to return different prices for each timestamp
  - Assert each block has the correct `baseFeePerGas`

**Integration / Live**

- [ ] Test C: After deployment, query Blockscout stats API and verify `gas_prices` values are in the same order of magnitude as `eth_gasPrice` (no negative priority fees)

### 8.3 Baseline

- Pre-fix baseline: `baseFeePerGas` = current gas price for all blocks (test should fail with historical blocks)
- Post-fix: `baseFeePerGas` = block-timestamp gas price (test should pass)

---

## 9) STEP-BY-STEP IMPLEMENTATION PLAN

### Phase 0 — Preflight

1. **Verify branch and working tree**
   ```bash
   cd /Users/alex/goliath/json-rpc-relay
   git status -sb
   ```
   Expected output: on `fix/max-fee-per-gas-weibar` or a new branch forked from it.
   Failure mode: unexpected dirty state.
   Rollback: stash or checkout as needed.

### Phase 1 — Red (tests first)

2. **Write failing tests for block-time baseFeePerGas**
   - Add test in blockWorker test file asserting `baseFeePerGas` uses block timestamp
   - Run tests to confirm red:
   ```bash
   cd /Users/alex/goliath/json-rpc-relay/packages/relay
   npx ts-mocha --recursive './tests/**/*.spec.ts' -g 'baseFeePerGas' --exit
   ```
   Expected output: FAIL — `baseFeePerGas` assertion mismatches.
   Failure mode: unrelated test failures.
   Rollback: `git checkout -- tests/`

### Phase 2 — Green (implement fix)

3. **Patch `blockWorker.ts` to use block timestamp**
   Target file: `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts`

   Replace line 321:
   ```typescript
   // Before:
   const gasPrice = await commonService.gasPrice(requestDetails);

   // After:
   const blockTimestamp = blockResponse?.timestamp?.from?.split('.')[0] ?? '';
   const gasPriceForBlock = await commonService.getGasPriceInWeibars(requestDetails, blockTimestamp);
   const gasPrice = numberTo0x(gasPriceForBlock);
   ```

   Then run tests:
   ```bash
   cd /Users/alex/goliath/json-rpc-relay/packages/relay
   npx ts-mocha --recursive './tests/**/*.spec.ts' -g 'baseFeePerGas' --exit
   ```
   Expected output: targeted tests pass.
   Failure mode: type errors or null handling issues.
   Rollback: `git checkout -- src/lib/services/ethService/blockService/blockWorker.ts`

### Phase 3 — Validate

4. **Run full relay test suite**
   ```bash
   cd /Users/alex/goliath/json-rpc-relay/packages/relay
   npx ts-mocha --recursive './tests/**/*.spec.ts' --exit
   ```
   Expected output: green suite (same pass/fail counts as baseline).
   Failure mode: regression in block-related tests.
   Rollback: isolate and revert offending changes.

5. **Run lint + build**
   ```bash
   cd /Users/alex/goliath/json-rpc-relay
   npm run lint
   npm run build
   ```
   Expected output: lint/build success.
   Failure mode: lint violations or TS build errors.
   Rollback: fix lint issues or revert.

### Phase 4 — Commit and Push

6. **Commit and push**
   ```bash
   cd /Users/alex/goliath/json-rpc-relay
   git add packages/relay/src/lib/services/ethService/blockService/blockWorker.ts \
           <test files>
   git commit --signoff -m "fix: use block timestamp for baseFeePerGas instead of current gas price"
   git push origin fix/max-fee-per-gas-weibar
   ```
   Expected output: commit pushed successfully.
   Failure mode: pre-commit hook failures.
   Rollback: fix and re-commit.

### Phase 5 — Build and Deploy

7. **Build updated Docker image**
   ```bash
   cd /Users/alex/goliath/json-rpc-relay
   docker build -t ghcr.io/crypt0grapher/hiero-json-rpc-relay:0.75.0-fix-4901-v2 .
   docker push ghcr.io/crypt0grapher/hiero-json-rpc-relay:0.75.0-fix-4901-v2
   ```
   Expected output: image pushed to GHCR.
   Failure mode: build or auth failure.
   Rollback: keep current running image.

8. **Canary then full rollout**
   ```bash
   ssh lon "kubectl set image deploy/relay-1-ws server=ghcr.io/crypt0grapher/hiero-json-rpc-relay:0.75.0-fix-4901-v2 -n kubernetes && \
     kubectl rollout status deploy/relay-1-ws -n kubernetes --timeout=180s"

   ssh lon "for d in relay-internal-ws relay-1 relay-internal; do \
     kubectl set image deploy/\$d server=ghcr.io/crypt0grapher/hiero-json-rpc-relay:0.75.0-fix-4901-v2 -n kubernetes && \
     kubectl rollout status deploy/\$d -n kubernetes --timeout=300s || exit 1; \
   done"
   ```
   Expected output: all rollouts complete with healthy pods.
   Failure mode: CrashLoopBackOff, readiness failures.
   Rollback:
   ```bash
   ssh lon "for d in relay-1-ws relay-internal-ws relay-1 relay-internal; do kubectl rollout undo deploy/$d -n kubernetes; done"
   ```

### Phase 6 — Live Validation

9. **Verify Blockscout stats API**
   ```bash
   curl -s https://testnet.explorer.goliath.net/api/v2/stats | jq '.gas_prices'
   ```
   Expected output: gas prices in the same order of magnitude as `eth_gasPrice`, no negative values.

10. **Spot-check historical blocks**
    ```bash
    # Get a recent block
    curl -s -X POST http://104.238.187.163:30756 \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["latest", false],"id":1}' \
      | jq '{baseFeePerGas: .result.baseFeePerGas, number: .result.number}'

    # Get an older block and compare
    curl -s -X POST http://104.238.187.163:30756 \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x100", false],"id":1}' \
      | jq '{baseFeePerGas: .result.baseFeePerGas, number: .result.number}'
    ```
    Expected output: `baseFeePerGas` values differ between blocks if gas prices changed.

### Rollback Criteria (applies to all post-deploy phases)

**Triggers**
- RPC error-rate spike
- Relay pods fail readiness/liveness
- `baseFeePerGas` still showing current gas price for historical blocks
- New unexpected failures in Blockscout

**Procedure**
```bash
ssh lon "for d in relay-1 relay-internal relay-1-ws relay-internal-ws; do kubectl rollout undo deploy/$d -n kubernetes; done"
```

---

## 10) VERIFICATION CHECKLIST

**Phase 0-3 (Code)**
- [ ] Targeted red/green tests executed and recorded
- [ ] Relay suite passes (same baseline as before)
- [ ] Lint/build pass
- [ ] Block-time gas price behavior validated in tests
- [ ] Commit pushed to fork

**Phase 5 (Deploy)**
- [ ] Docker image built and pushed to GHCR
- [ ] Canary deployment validated
- [ ] Full rollout completed
- [ ] All pods healthy

**Phase 6 (Live Validation)**
- [ ] Blockscout stats API shows consistent gas prices (no negatives)
- [ ] Historical blocks show block-time `baseFeePerGas` (not current gas price)
- [ ] `effectiveGasPrice <= baseFeePerGas` for transactions in the same block

---

## 11) IMPLEMENTATION LOG

### Actions Taken

| Time (UTC) | Action | Result | Notes |
|------------|--------|--------|-------|
| 2026-02-10 18:00 | Created issue document | OK | Analysis complete |
| 2026-02-10 18:00 | **Phase 2 — Code fix applied** to `blockWorker.ts:321` | CODE DONE | Uses `getGasPriceInWeibars(requestDetails, blockTimestamp)` |
| 2026-02-10 18:05 | Test mocks updated for timestamped `network/fees` query | CODE DONE | Regex mock in both block test files |
| 2026-02-10 18:05 | Build passes | OK | All 4 packages compile |
| 2026-02-10 18:10 | Block tests: 41/44 passing | OK | 3 failures are PRE-EXISTING timeouts (confirmed by reverting) |
| 2026-02-10 ~19:00 | **Live gas analysis** | OK | baseFeePerGas drift confirmed: 16,350-16,670 Gwei across blocks |
| 2026-02-10 ~19:00 | Verified `GAS_PRICE_PERCENTAGE_BUFFER=0` | OK | No practical difference between `gasPrice()` and `getGasPriceInWeibars()` |
| 2026-02-10 ~19:15 | **Blockscout normalized** (via fix 1 only) | OK | gas_prices all ~16,180 Gwei, no negative priority fees |
| | **NEEDS: Run full targeted test suite** | pending | |
| | **NEEDS: Lint** | pending | |
| | **NEEDS: Commit fix 2** | pending | Blocked by test validation |
| | **NEEDS: Rebuild Docker image + redeploy** | pending | Blocked by commit |
| | **NEEDS: Verify baseFeePerGas consistency post-deploy** | pending | Blocked by deploy |

### Failed Attempts

(none)

### Final State

- **Code:** Fix applied in `blockWorker.ts:321` — uses `getGasPriceInWeibars(requestDetails, blockTimestamp)` instead of `gasPrice(requestDetails)`
- **Tests:** Block tests 41/44 passing (3 pre-existing timeouts)
- **Build:** All 4 packages compile
- **Blockscout:** NORMALIZED from fix 1 alone — fix 2 is a correctness improvement, no longer urgent
- **baseFeePerGas drift:** Confirmed 320 Gwei (10 tinybars) drift across blocks due to current-gas-price-at-query-time

### Live Gas Values (snapshot ~19:15 UTC)

| Metric | Value | Notes |
|--------|-------|-------|
| `eth_gasPrice` (public) | 16,670 Gwei (1,667 tb) | Current fee schedule |
| `baseFeePerGas` (latest block) | 16,670 Gwei | Matches current gas price |
| `baseFeePerGas` (block 136704) | 16,570 Gwei (1,657 tb) | Drift: cached at query time |
| `baseFeePerGas` (block 136192) | 16,350 Gwei (1,635 tb) | Max observed drift |
| Blockscout `gas_prices` | 16,180 Gwei (all bands) | Normalized, converging upward |

### Next Steps (in order)

1. **Run full targeted test suite** (commit 1 + fix 2 files)
2. **Lint** on changed files
3. **Commit fix 2** with `--signoff`
4. **Push** to fork branch
5. **Rebuild Docker image** + redeploy to all 4 relays
6. **Verify baseFeePerGas consistency** — historical blocks should return their own timestamp's gas price

---

## 12) FOLLOW-UPS

- [ ] Investigate whether `eth_feeHistory` has the same current-vs-historical gas price issue
- [ ] Investigate whether the `addPercentageBufferToGasPrice()` call in `gasPrice()` should also be removed or adjusted for the `eth_gasPrice` RPC method itself
- [ ] Add monitoring/alerting for `baseFeePerGas` consistency (e.g., `baseFeePerGas` for block N should be close to `effectiveGasPrice` for transactions in block N)
- [ ] Once upstream PR for fix-4901 is merged, include this fix in the same or a follow-up PR
