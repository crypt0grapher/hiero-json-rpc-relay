# Subtask 004: Audit and Document Remaining Goliath Patches

**Status:** COMPLETED (2026-03-30, GOLIATH-PATCHES.md created, 21/21 commits classified)
**Priority:** P2 (parallel with other subtasks)
**Blocked by:** Nothing
**Blocks:** Nothing (documentation, but informs future maintenance)
**Estimated time:** 2-3 hours
**Branch:** `docs/goliath-patches` (or committed directly to main)

---

## Context

The Goliath relay fork has diverged from upstream `hiero-json-rpc-relay` with 17
non-merge commits since the base fork point. Some are permanent Goliath deltas (chain
ID, fee model), some are temporary workarounds (nonce floor), and some are upstream
cherry-picks (baseFee=0x0).

For maintainability, every commit must be classified and documented. When upstream
releases a new version, the maintainer needs to know exactly which patches to carry
forward, which to drop, and which have been upstreamed.

---

## What to Produce

### File: `GOLIATH-PATCHES.md` in repository root

This file documents every Goliath-specific delta from upstream, organized by category.

---

## Audit Process

### Step 1: Enumerate All Goliath Commits

```bash
cd ~/goliath/json-rpc-relay

# Find the fork point (last upstream commit before Goliath patches)
# Based on git log, d6f90538 is the first Goliath commit (rebranding)
# The commit before it is the upstream base
git log --oneline --no-merges d6f90538^..HEAD
```

### Step 2: Classify Each Commit

For each commit, determine:

| Field | Options |
|-------|---------|
| **Category** | `permanent` / `temporary` / `upstream-cherry-pick` / `reverted` |
| **Domain** | `identity` / `fee-model` / `nonce` / `evm-compat` / `ops` / `tests` |
| **Upstream PR** | Link to upstream PR if this is a cherry-pick or will be upstreamed |
| **Remove after** | Condition for removal (if temporary) |
| **Files changed** | Key files affected |

### Step 3: Current Commit Classification

Based on `git log --oneline --no-merges d6f90538^..HEAD`:

| Commit | Message | Category | Domain | Notes |
|--------|---------|----------|--------|-------|
| `fc34cbb5` | Lazy-create gas floor | permanent | evm-compat | mirror-web3 underestimates lazy-create gas |
| `36f22c19` | Revert nonce authority unification | reverted | nonce | Was incorrect approach |
| `c31ce4c3` | Unify nonce authority | reverted | nonce | Reverted by 36f22c19 |
| `a93cf9fc` | Revert nonce floor deadlock fix | reverted | nonce | Was incorrect approach |
| `25707be3` | Nonce floor deadlock fix | reverted | nonce | Reverted by a93cf9fc |
| `223b0790` | CLAUDE.md deployment workflow | permanent | ops | Documentation |
| `cbe5dc47` | XCN rate limits 10x | permanent | ops | Goliath traffic profile |
| `30e16af5` | Nonce floor logging | temporary | nonce | Remove with nonce floor (subtask-003) |
| `7eb86b76` | Nonce floor cache update after tx | temporary | nonce | Remove with nonce floor (subtask-003) |
| `d1b6f1d2` | Nonce floor from contract results | temporary | nonce | Remove with nonce floor (subtask-003) |
| `89fd1a85` | baseFeePerGas = gas price | reverted | fee-model | Superseded by 7f6b07ec |
| `aeac5ffc` | Align block tests with baseFeePerGas=0x1 | permanent | tests | Test alignment for HIP-415 |
| `0ba4023a` | tinybar to weibar ecrecover | permanent | evm-compat | Mirror returns tinybar |
| `8d0f02f3` | EIP-1559 precheck + ecrecover + baseFee=0x1 | permanent | fee-model + evm-compat | Hedera fee model |
| `7f6b07ec` | baseFeePerGas = 0x0 per HIP-415 | upstream-cherry-pick | fee-model | Upstream #5023 |
| `e69cb64c` | Rebrand HBAR to XCN | permanent | identity | Fork identity |
| `2e50e873` | Chain ID 0x147 | permanent | identity | Fork chain ID |
| `d6f90538` | Rebrand relay for Goliath | permanent | identity | Fork identity |

Note: The isEvmTransaction filter, TransactionBlockCache, and block 0 gas fix may be
in earlier commits or part of the base fork. Verify with `git log --all --oneline`.

### Step 4: Document Permanent Patches with Justification

For each `permanent` patch, document:
- **What it changes:** Exact behavioral difference from upstream
- **Why it is permanent:** Goliath-specific reason it cannot be upstreamed
- **Risk of removal:** What breaks if this patch is accidentally dropped during rebase
- **Files affected:** For maintainer reference during merge conflicts

### Step 5: Document Temporary Patches with Removal Conditions

For each `temporary` patch, document:
- **What it works around:** The upstream or infrastructure bug
- **Removal condition:** When can it be safely removed
- **Verification before removal:** How to confirm the condition is met

---

## GOLIATH-PATCHES.md Template

```markdown
# Goliath Relay Patches

Goliath-specific modifications to the upstream hiero-json-rpc-relay.
This document is the authoritative source for understanding fork divergence.

**Upstream base:** [commit hash] (tag/release)
**Fork date:** [date]
**Last audit:** 2026-03-30

## Permanent Patches (Carry Forward on Every Rebase)

### 1. Fork Identity and Branding
- **Commits:** d6f90538, e69cb64c, 2e50e873
- **What:** Chain ID 0x147 (327), XCN token name, Goliath branding
- **Why permanent:** Core fork identity
- **Files:** constants.ts, various UI strings
- **Risk of removal:** Wrong chain ID breaks all wallets

### 2. HIP-415 Fee Model (baseFeePerGas = 0x0)
- **Commits:** 7f6b07ec, 8d0f02f3
- **Upstream:** Cherry-pick of hiero-json-rpc-relay#5023
- **What:** baseFeePerGas=0x0, eth_feeHistory.reward=gas price, maxPriorityFeePerGas=gas price
- **Why permanent:** Hedera has no EIP-1559 floating base fee
- **Files:** model.ts, blockFactory.ts, FeeService.ts, precheck.ts
- **Risk of removal:** Blockscout gas tracker shows 14K Gwei, MetaMask maxFeePerGas=undefined

### 3. ecrecover Tinybar-to-Weibar Conversion
- **Commits:** 0ba4023a, 8d0f02f3
- **What:** Multiply mirror API fee/value fields by 10^10 before ethers.Transaction.from()
- **Why permanent:** Goliath mirror returns tinybar, RLP signature is over weibar
- **Files:** TransactionService.ts, blockWorker.ts
- **Risk of removal:** Wrong `from` address in receipts

### 4. Lazy-Create Gas Floor (587K)
- **Commit:** fc34cbb5
- **What:** estimateGas returns 587K for non-existent addresses, precheck rejects low-gas lazy-creates
- **Why permanent:** mirror-web3 EVM simulation does not model Hedera lazy-create gas charges
- **Files:** ContractService.ts, precheck.ts
- **Risk of removal:** All MetaMask transfers to new addresses fail with INSUFFICIENT_GAS

### 5. XCN Rate Limits
- **Commit:** cbe5dc47
- **What:** 10x default rate limits
- **Why permanent:** Goliath traffic profile requires higher limits
- **Files:** configuration.md, config defaults

### 6. EVM Transaction Filter (isEvmTransaction)
- **What:** Filters non-EVM transactions from block responses
- **Why permanent:** Hedera SDK ContractCalls have chain_id=null, r/s/v=null
- **Files:** blockWorker.ts
- **Risk of removal:** Blockscout rejects all blocks, total_transactions=0

### 7. TransactionBlockCache Receipt Fallback
- **What:** Maps phantom tx hashes to blocks during getBlock, uses cache for getTransactionReceipt
- **Why permanent:** Phantom tx hashes from populateSyntheticTransactions have no individual receipts
- **Files:** transactionBlockCache.ts, TransactionService.ts
- **Risk of removal:** Receipt lookup returns null for some hashes

### 8. Block 0 Gas Price Fallback
- **What:** Try-catch around getBlock(0) and getBlockReceipts(0) gas price lookup
- **Why permanent:** Genesis block has no fee schedule data in mirror
- **Files:** blockService
- **Risk of removal:** eth_getBlockByNumber("0x0") throws error

## Temporary Patches (Remove When Condition Met)

### T1. Nonce Floor from Contract Results
- **Commits:** d1b6f1d2, 7eb86b76, 30e16af5
- **What:** Queries contracts/results?from=<addr> as secondary nonce source
- **Remove when:** Importer fix deployed and stable for 24h on FRA canary
- **Verification:** All active EVM senders have consensus nonce = mirror nonce
- **Files:** AccountService.ts:457-484, TransactionService.ts:849-860, constants.ts
- **Tracked by:** subtask-003-remove-nonce-floor.md

## Reverted Patches (Dead Code, Kept in History Only)

### R1. Nonce floor deadlock fixes (2 attempts, both reverted)
- **Commits:** 25707be3 (reverted by a93cf9fc), c31ce4c3 (reverted by 36f22c19)
- **What:** Attempts to fix handleSubmissionError nonce authority split
- **Why reverted:** Incorrect approaches that introduced other issues
```

---

## Build and Test

No code changes -- documentation only. But verify the audit is complete:

```bash
cd ~/goliath/json-rpc-relay

# Count total non-merge Goliath commits
git log --oneline --no-merges d6f90538^..HEAD | wc -l

# Verify all are classified in GOLIATH-PATCHES.md
# The count should match the number of entries in the document
```

---

## Acceptance Checklist

- [ ] `GOLIATH-PATCHES.md` created in repository root
- [ ] Every non-merge commit since fork point is classified
- [ ] Permanent patches have justification and risk-of-removal documented
- [ ] Temporary patches have explicit removal conditions
- [ ] Reverted patches are documented for historical reference
- [ ] File paths listed for each patch (for merge conflict guidance)
- [ ] Upstream PR links included where applicable
