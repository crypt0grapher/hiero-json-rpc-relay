# Goliath Relay Patches

Goliath-specific modifications to the upstream hiero-json-rpc-relay.
This document is the authoritative source for understanding fork divergence.

**Upstream base:** `5fe7c527` (post-v0.75.0, pre-v0.76.0-rc3, dated 2026-03-17)
**Fork date:** 2026-02-10 (first Goliath commit `81307136`)
**Last audit:** 2026-03-30
**Total Goliath commits:** 21 (non-merge)

---

## Permanent Patches (Carry Forward on Every Rebase)

### P1. Fork Identity and Branding

- **Commits:** `d6f90538`, `2e50e873`, `e69cb64c`
- **What:**
  - `web3_clientVersion` returns `goliath-relay/` prefix instead of `relay/`
  - Default `CHAIN_ID` changed from `0x12a` (Hedera mainnet) to `0x147` (Goliath mainnet, 327 decimal)
  - `CHAIN_IDS` constant map extended with `goliath: 0x147` and `goliath_testnet: 0x22c5`
  - All user-facing HBAR/hbar string references replaced with XCN across error messages, log messages, Prometheus metric help text, JSDoc comments, config comments, env examples, OpenRPC spec, and Helm values
  - Internal identifiers (class names, env var keys, file paths, cache keys, metric names) are preserved unchanged for upstream merge compatibility
  - README.md fully rewritten with Goliath branding
- **Why permanent:** Core network identity. Goliath is a distinct chain.
- **Files:**
  - `packages/relay/src/lib/web3.ts` (client version prefix)
  - `packages/config-service/src/services/globalConfig.ts` (CHAIN_ID default)
  - `packages/relay/src/lib/constants.ts` (CHAIN_IDS map)
  - `packages/relay/src/lib/clients/sdkClient.ts` (log messages)
  - `packages/relay/src/lib/config/hbarSpendingPlanConfigService.ts` (comments/logs)
  - `packages/relay/src/lib/db/types/hbarLimiter/errors.ts` (error messages)
  - `packages/relay/src/lib/db/types/hbarLimiter/hbarSpendingPlanRepository.ts` (comments)
  - `packages/relay/src/lib/errors/JsonRpcError.ts` (error messages)
  - `packages/relay/src/lib/precheck.ts` (comment)
  - `packages/relay/src/lib/relay.ts` (log messages)
  - `packages/relay/src/lib/services/ethService/ethCommonService/CommonService.ts` (comment)
  - `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts` (comment)
  - `packages/relay/src/lib/services/hapiService/hapiService.ts` (log messages)
  - `packages/relay/src/lib/services/hbarLimitService/index.ts` (log messages)
  - `packages/relay/src/lib/services/metricService/metricService.ts` (metric help text)
  - `packages/relay/src/lib/types/mirrorNode.ts` (comment)
  - `.env.http.example` (comments)
  - `charts/hedera-json-rpc-relay/values.yaml` (comments)
  - `dapp-example/localDappCI.env` (comments)
  - `docs/openrpc.json` (API descriptions)
  - `README.md` (full rewrite)
  - Tests: `web3.spec.ts`, `rpcMethod.spec.ts`, `server.spec.ts`
- **Risk of removal:** Chain identity breaks. Blockscout shows wrong network name. web3.clientVersion returns wrong prefix.

### P2. CI Workflow and Upstream Workflow Stubs

- **Commits:** `d6f90538`
- **What:**
  - New `.github/workflows/build-relay.yaml` -- builds Docker image on push to `main`, publishes to GHCR as `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:main`
  - All 22 inherited upstream CI workflows reduced to stubs (empty `jobs:` with `if: false` or no-op) to prevent them from running on the fork
- **Why permanent:** Fork uses its own CI pipeline. Upstream workflows reference infrastructure (Hedera testnet nodes, internal secrets) that does not exist for Goliath.
- **Files:**
  - `.github/workflows/build-relay.yaml` (new, 82 lines)
  - `.github/workflows/*.yml` (22 files stubbed)
- **Risk of removal:** CI breaks. No Docker image gets built on push. Or upstream workflows start running and fail noisily.

### P3. XCN Rate Limit Defaults (10x Increase)

- **Commits:** `cbe5dc47`
- **What:** Default spending limits increased 10x from upstream Hedera values:
  - BASIC: 300M tinybar (3 HBAR) -> 3B tinybar (30 XCN)
  - EXTENDED: 100M tinybar (1 HBAR) -> 1B tinybar (10 XCN)
  - PRIVILEGED: 270M tinybar (2.7 HBAR) -> 2.7B tinybar (27 XCN)
  - Total budget: 25B tinybar (250 HBAR) -> 250B tinybar (2500 XCN)
  - Duration unchanged at 86400000ms (24h)
- **Why permanent:** XCN is much cheaper than HBAR, so users need higher budgets for equivalent dollar value.
- **Files:**
  - `packages/config-service/src/services/globalConfig.ts` (4 default values)
  - `.env.http.example` (4 comment values)
- **Risk of removal:** Users hit rate limits 10x faster. Most MetaMask users would be blocked after a few transactions.

### P4. Tinybar-to-Weibar Conversion in Transaction Factory (EIP-1559 Fee Fields)

- **Commits:** `81307136`
- **What:** In `createTransactionFromContractResult()`, apply `TINYBAR_TO_WEIBAR_COEF` (10^10) multiplication to `max_fee_per_gas` and `max_priority_fee_per_gas` fields from the mirror API. The mirror returns these in tinybar but EVM clients expect weibar (1 tinybar = 10^10 weibar). Without conversion, type-2 transaction fee fields show values 10^10 too small.
- **Why permanent:** This is an upstream bug (hiero-ledger/hiero-json-rpc-relay#4901). The `gasPrice` field already had the conversion; `maxFeePerGas`/`maxPriorityFeePerGas` were missed. Until upstream merges this fix, it must be carried.
- **Files:**
  - `packages/relay/src/lib/factories/transactionFactory.ts`
  - Tests: `eth_getTransactionByBlockHashAndIndex.spec.ts`, `eth_getTransactionByBlockNumberAndIndex.spec.ts`, `eth_getTransactionByHash.spec.ts`, `transactionFactory.spec.ts`
- **Risk of removal:** EIP-1559 transactions show incorrect maxFeePerGas/maxPriorityFeePerGas in API responses. Blockscout shows wrong gas prices for type-2 txs.

### P5. baseFeePerGas = Gas Price (Non-EIP-1559 Chain Model)

- **Commits:** `7f6b07ec`, `8d0f02f3`, `aeac5ffc`, `89fd1a85`
- **What:** Complete reworking of the EIP-1559 fee model for a non-EIP-1559 chain:
  - baseFeePerGas in blocks and eth_feeHistory set to the chain's actual gas price (~490 Gwei on mainnet), not 0x0 or a static default
  - eth_maxPriorityFeePerGas returns `0x0` (no tipping system)
  - eth_feeHistory reward arrays filled with `0x0`
  - Block model default baseFeePerGas changed from `0xa54f4c3c00` to `0x1` (safe fallback; must be >0 because ethers.js treats BigInt(0) as falsy, breaking MetaMask's getFeeData())
  - FeeService constructor no longer takes mirrorNodeClient (removed getFeeByBlockNumber private method that fetched per-block fees)
  - FeeService.maxPriorityFeePerGas now accepts RequestDetails parameter (signature change in interface and EthImpl)
  - baseFeePerGas in feeHistory always uses current gas price (not per-block historical lookups)
- **Why permanent:** Goliath (like Hedera) has no EIP-1559 base fee burning mechanism. The entire gas price IS the base fee. Upstream had a mix of 0x0 and static values that confused Blockscout's gas oracle (~14K Gwei) and broke MetaMask (maxFeePerGas=undefined).
- **Files:**
  - `packages/relay/src/lib/services/ethService/feeService/FeeService.ts` (major refactor)
  - `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts` (baseFeePerGas in getBlock)
  - `packages/relay/src/lib/factories/blockFactory.ts` (baseFeePerGas = gasPrice)
  - `packages/relay/src/lib/model.ts` (Block default baseFeePerGas)
  - `packages/relay/src/lib/eth.ts` (FeeService constructor, maxPriorityFeePerGas signature)
  - `packages/relay/src/index.ts` (Eth interface signature)
  - Tests: `eth_getBlockByNumber.spec.ts`, `eth-config.ts`, `eth_feeHistory.spec.ts`, `assertions.ts`, `eth_getBlockByHash.spec.ts`
- **Risk of removal:** Blockscout gas oracle shows wildly incorrect prices. MetaMask breaks on getFeeData() if baseFeePerGas is 0. EIP-1559 wallet fee estimation fails.

### P6. EIP-1559 Precheck Fix (maxFeePerGas Only, Not Sum)

- **Commits:** `8d0f02f3`
- **What:** In `precheck.gasPrice()` and `precheck.balanceCheck()`, type-2 transactions now use `maxFeePerGas` alone as the fee cap instead of `maxFeePerGas + maxPriorityFeePerGas`. The sum has no EIP-1559 semantic meaning and was letting under-priced transactions reach consensus where they fail with INSUFFICIENT_TX_FEE.
- **Why permanent:** This is an upstream bug. On Hedera with baseFee=0, maxFeePerGas is the correct bound for validation. Summing maxFeePerGas + maxPriorityFeePerGas inflates the effective price used for comparison, allowing transactions that cannot pay the actual gas price to pass precheck.
- **Files:**
  - `packages/relay/src/lib/precheck.ts` (gasPrice method + balanceCheck method)
  - Tests: `precheck.spec.ts`
- **Risk of removal:** Under-priced EIP-1559 transactions pass precheck but fail at consensus, wasting Hedera processing fees.

### P7. ecrecover Sender Recovery (Transaction `from` Field)

- **Commits:** `8d0f02f3`, `0ba4023a`
- **What:** Recover the EVM sender address from r/s/v ECDSA signature fields using `ethers.Transaction.from()` instead of relying on the mirror node's `resolveEvmAddress` for the `from` field. Mirror-node contract results store fee/value fields in tinybar, so they must be multiplied by `TINYBAR_TO_WEIBAR_COEF` before ecrecover to reconstruct the correct unsigned-tx hash. Applied in three places:
  - `TransactionService.recoverTransactionSender()` -- used by getTransactionByHash, getTransactionReceipt, getTransactionByBlockAndIndex
  - `blockWorker.recoverSenderFromContractResult()` -- used by getBlock, getBlockReceipts
  - Graceful fallback: if ecrecover fails, falls back to resolveEvmAddress
- **Why permanent:** Without ecrecover, all transactions showed the relay operator address as the sender. The mirror node stores the Hedera account ID that submitted the `EthereumTransaction`, which resolves to the relay operator's EVM address, not the actual wallet.
- **Files:**
  - `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts` (recoverTransactionSender method + 4 call sites)
  - `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts` (recoverSenderFromContractResult function + 2 call sites)
  - Tests: `eth_getTransactionReceipt.spec.ts`, `ethGetBlockBy.spec.ts`
- **Risk of removal:** All transactions show the relay operator as the sender. Blockscout attributes every tx to the same address. Wallet history is completely wrong.

### P8. isEvmTransaction Filter (Block Non-EVM Transaction Exclusion)

- **Commits:** `8d0f02f3`
- **What:** New `isEvmTransaction()` function in blockWorker.ts filters out non-EVM transactions (Hedera SDK CryptoTransfer, TokenMint, etc.) from block responses. Non-EVM results have `chain_id: null` and no ECDSA signature fields. The filter is applied in `getBlock()`, `getBlockReceipts()`, and `getRawReceipts()` before building transaction arrays and receipt roots.
- **Why permanent:** Without filtering, Blockscout receives invalid transaction objects with null chain_id and no signature, causing parsing errors and showing garbage entries in block pages.
- **Files:**
  - `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts` (isEvmTransaction function + 4 filter sites)
- **Risk of removal:** Block responses contain unparseable non-EVM transactions. Blockscout block pages break.

### P9. TransactionBlockCache (Phantom Transaction Resolution)

- **Commits:** `8d0f02f3`
- **What:** New `TransactionBlockCache` class -- an in-process LRU Map that maps tx hashes to block numbers. Populated during `getBlock()` for every transaction in the block. Used as a last-resort fallback in `getTransactionByHash()` and `getTransactionReceipt()` when the mirror node has no individual contract-result entry for a hash that appeared in a block response (e.g. synthetic transactions from `populateSyntheticTransactions()`).
  - Max size: 200,000 entries (configurable via `TX_BLOCK_CACHE_MAX_SIZE`)
  - TTL: 1 hour (configurable via `TX_BLOCK_CACHE_TTL_MS`)
  - Process-local (not Redis); only works when `WORKERS_POOL_ENABLED=false` (Goliath default)
- **Why permanent:** Without this cache, Blockscout requests `eth_getTransactionReceipt` for hashes it saw in `eth_getBlockByNumber` and gets null, causing "missing receipt" errors and broken block pages.
- **Files:**
  - `packages/relay/src/lib/services/ethService/transactionBlockCache.ts` (new, 93 lines)
  - `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts` (handleBlockCacheFallbackReceipt method + getTransactionByHash fallback)
  - `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts` (cache population in getBlock)
  - Tests: `transactionBlockCache.spec.ts`
- **Risk of removal:** Phantom transactions return null for getTransactionByHash/getTransactionReceipt. Blockscout block indexing breaks for blocks containing synthetic transactions.

### P10. Block-Time Gas Price for baseFeePerGas (Historical Consistency)

- **Commits:** `922e7c6f`
- **What:** In `blockWorker.getBlock()`, `baseFeePerGas` is computed using `getGasPriceInWeibars(requestDetails, blockTimestamp)` to fetch the fee schedule at block creation time, instead of the current network gas price at query time. This ensures baseFeePerGas is stable across queries and matches the gas price that was active when the block was produced.
- **Why permanent:** Without block-time pricing, baseFeePerGas drifts depending on when a block is first queried. Blockscout's gas oracle sees inconsistent values across blocks, producing unreliable gas price estimates.
- **Files:**
  - `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts` (getBlock function)
  - Tests: `eth_getBlockByHash.spec.ts`, `eth_getBlockByNumber.spec.ts`
- **Risk of removal:** baseFeePerGas values in blocks are query-time dependent instead of block-time consistent. Blockscout gas oracle shows unreliable prices.

### P11. Genesis Block (Block 0) Gas Price Fallback

- **Commits:** `8d0f02f3` (part of the blockWorker changes)
- **What:** In `blockWorker.getBlockReceipts()`, when fetching the fee schedule at a block's timestamp fails for block 0 (genesis block has no fee schedule), falls back to the current network gas price instead of throwing.
- **Why permanent:** Without this fallback, `eth_getBlockReceipts` for block 0 throws an unhandled error. Blockscout fails to index the genesis block.
- **Files:**
  - `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts` (getBlockReceipts function)
- **Risk of removal:** eth_getBlockReceipts for block 0 throws. Blockscout genesis block indexing fails.

### P12. Lazy-Create Gas Floor (Hollow Account Creation Minimum)

- **Commits:** `fc34cbb5`
- **What:** Two-pronged protection for transfers to non-existent addresses:
  1. `ContractService.estimateGas()`: when the mirror estimate is below `MIN_TX_HOLLOW_ACCOUNT_CREATION_GAS` (587,000), the destination has a non-zero value, and the address does not exist on Hedera, returns 587,000 instead of the mirror estimate
  2. `Precheck.receiverAccount()`: rejects `eth_sendRawTransaction` with gasLimit below 587,000 when the destination address does not exist, saving the user the Hedera processing fee on guaranteed-failure transactions
- **Why permanent:** Hedera lazy-create (hollow account creation) requires minimum 587,000 gas, but mirror-web3 returns ~47,802 for simple transfers to new addresses. Without this floor, MetaMask transfers to new addresses always fail with INSUFFICIENT_GAS.
- **Files:**
  - `packages/relay/src/lib/services/ethService/contractService/ContractService.ts` (estimateGas + 2 helper methods)
  - `packages/relay/src/lib/precheck.ts` (receiverAccount method)
  - Tests: `eth_estimateGas.spec.ts`, `precheck.spec.ts`
- **Risk of removal:** All first-time transfers to new addresses fail. MetaMask users cannot send XCN to addresses that have never received a transaction.

---

## Temporary Patches (Remove When Condition Met)

_No active temporary patches._

### ~~T1. Nonce Floor from Contract Results~~ — REMOVED 2026-03-30

- **Commits:** `d1b6f1d2`, `7eb86b76`, `30e16af5` (added); `184856df` (removed)
- **What was:** Two-layer nonce floor (contract results + post-submission cache) compensating for stale mirror `ethereum_nonce`
- **Removed because:** Importer fix (`024f98474` in mirror-node) deployed to all 3 regions, mirror nonce now authoritative
- **Rollback:** `git revert 184856df` or deploy tag `rollback/nonce-floor-intact` (image `sha256:3d8804e8...`)

---

## Reverted Patches (History Only)

### R1. Advance Nonce Floor on WRONG_NONCE Equal Case

- **Commits:** `25707be3` (applied), `a93cf9fc` (reverted)
- **What:** When consensus returned WRONG_NONCE for nonce N and mirror reported ethereum_nonce = N (the "equal case"), the relay would advance the nonce floor cache to N+1 and throw NONCE_TOO_LOW. Intended to break the E2G bridge nonce deadlock where callers oscillated between nonce N (rejected by consensus) and N+1 (rejected by relay as too high).
- **Why reverted:** The approach was replaced by R2 (unified nonce authority), which was itself reverted. The equal-case logic was too aggressive -- it advanced the floor even when the mirror nonce was correct and the actual issue was the caller sending a duplicate nonce. Reverted to keep the simpler nonce floor model (T1) without WRONG_NONCE side effects.

### R2. Unified Nonce Authority Across eth_getTransactionCount and WRONG_NONCE Handler

- **Commits:** `c31ce4c3` (applied), `36f22c19` (reverted)
- **What:** Replaced the split-authority model where `eth_getTransactionCount` and `handleSubmissionError` used different nonce sources. Added `resolveEffectiveNonce()` to TransactionService and WRONG_NONCE evidence checking to AccountService. When WRONG_NONCE evidence existed for an address and mirror nonce exceeded the contract results floor, mirror was treated as inflated and the contract results floor was preferred.
- **Why reverted:** Over-engineered for the current problem. The WRONG_NONCE evidence cache introduced state coupling between send and query paths, making behavior harder to reason about. The simpler nonce floor (T1) plus the upcoming importer fix provides equivalent protection. This approach may be revisited if the importer fix is delayed, but in a simplified form (see subtask-001).

---

## Documentation and Operational Patches (No Code Impact)

### D1. CLAUDE.md Project Instructions

- **Commits:** `d6f90538`, `223b0790`
- **What:** New CLAUDE.md with project overview, build commands, architecture guide, deployment workflow, XCN rate limit documentation, and active patch table.
- **Files:** `CLAUDE.md`

### D2. Task Documentation and Investigation Notes

- **Commits:** `d6f90538`, `fc34cbb5`
- **What:** Investigation documents for fee cap issues, production deployment runbook, and task execution plans for rate limit deployment.
- **Files:**
  - `docs/tasks/2026-02-10-baseFeePerGas-Current-vs-Historical-Gas-Price.md`
  - `docs/tasks/2026-02-10-maxFeePerGas-Tinybar-Unit-Mismatch.md`
  - `docs/tasks/2026-03-11-production-deployment-goliath-relay.md`
  - `docs/tasks/xcn-rate-limit-increase-and-nonce-fix-deploy.md`
  - `.memory-bank/tasks/xcn-rate-limit-deploy/` (5 task files)

### D3. Blockscout Validation Script

- **Commits:** `fb2eeedf`
- **What:** New `scripts/validate-fee-caps.ts` -- a standalone diagnostic script that queries Blockscout's gas_prices API and validates consistency with eth_gasPrice. Not part of the relay runtime.
- **Files:** `scripts/validate-fee-caps.ts`

---

## Commit-to-Patch Cross-Reference

Every non-merge commit between the fork point (`5fe7c527`) and HEAD is listed below with its classification.

| # | Commit | Date | Classification | Patch |
|---|--------|------|---------------|-------|
| 1 | `81307136` | 2026-02-10 | permanent | P4 |
| 2 | `922e7c6f` | 2026-02-10 | permanent | P10 |
| 3 | `fb2eeedf` | 2026-02-10 | ops/docs | D3 |
| 4 | `d6f90538` | 2026-03-11 | permanent | P1, P2, D1, D2 |
| 5 | `2e50e873` | 2026-03-11 | permanent | P1 |
| 6 | `e69cb64c` | 2026-03-12 | permanent | P1 |
| 7 | `7f6b07ec` | 2026-03-25 | permanent | P5 |
| 8 | `8d0f02f3` | 2026-03-25 | permanent | P5, P6, P7, P8, P9, P11 |
| 9 | `0ba4023a` | 2026-03-25 | permanent | P7 |
| 10 | `aeac5ffc` | 2026-03-25 | permanent | P5 |
| 11 | `89fd1a85` | 2026-03-25 | permanent | P5 |
| 12 | `d1b6f1d2` | 2026-03-26 | temporary | T1 |
| 13 | `7eb86b76` | 2026-03-26 | temporary | T1 |
| 14 | `30e16af5` | 2026-03-27 | temporary | T1 |
| 15 | `cbe5dc47` | 2026-03-27 | permanent | P3 |
| 16 | `223b0790` | 2026-03-27 | ops/docs | D1 |
| 17 | `25707be3` | 2026-03-27 | reverted | R1 |
| 18 | `a93cf9fc` | 2026-03-27 | reverted | R1 |
| 19 | `c31ce4c3` | 2026-03-27 | reverted | R2 |
| 20 | `36f22c19` | 2026-03-27 | reverted | R2 |
| 21 | `fc34cbb5` | 2026-03-29 | permanent | P12, D2 |

**Classification totals:**
- Permanent: 13 commits (across 12 patch categories)
- Temporary: 3 commits (1 patch category)
- Reverted: 4 commits (2 pairs, net zero code impact)
- Ops/docs: 2 commits (no runtime code)
- **Unclassified: 0**

---

## Files Most Likely to Conflict on Upstream Rebase

These files have the heaviest Goliath modifications and are also actively
developed upstream. Listed in descending order of conflict risk.

| File | Patches | Lines changed |
|------|---------|---------------|
| `packages/relay/src/lib/services/ethService/blockService/blockWorker.ts` | P5, P7, P8, P9, P10, P11 | +176 |
| `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts` | P7, P9, T1 | +264 |
| `packages/relay/src/lib/services/ethService/feeService/FeeService.ts` | P5 | -66/+31 (net refactor) |
| `packages/relay/src/lib/services/ethService/accountService/AccountService.ts` | T1 | +57 |
| `packages/relay/src/lib/precheck.ts` | P6, P12 | +30 |
| `packages/relay/src/lib/services/ethService/contractService/ContractService.ts` | P12 | +65 |
| `packages/relay/src/lib/eth.ts` | P5 | +19 |
| `packages/relay/src/lib/factories/transactionFactory.ts` | P4 | +18 |
| `packages/config-service/src/services/globalConfig.ts` | P1, P3 | +8 |

---

## Upstream Issue Tracking

| Patch | Upstream Issue | Status |
|-------|---------------|--------|
| P4 (weibar fee fields) | hiero-ledger/hiero-json-rpc-relay#4901 | Open, not yet merged upstream |
| P5 (baseFeePerGas model) | Cherry-pick of upstream #5023 concept | Partially addressed upstream |
| P6 (precheck sum bug) | Not filed upstream | Goliath-discovered, should be filed |
| P7 (ecrecover sender) | Not filed upstream | Goliath-specific (operator relay model) |
| P8 (non-EVM filter) | Not filed upstream | Goliath-specific (mixed tx blocks) |
| T1 (nonce floor) | Not filed upstream | Goliath workaround for importer bug |
