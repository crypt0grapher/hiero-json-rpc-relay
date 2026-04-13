# Subtask 003: Remove Nonce Floor After Importer Canary

**Status:** COMPLETED (2026-03-30, deployed sha256:3d7a50e3..., rollback tag: rollback/nonce-floor-intact)
**Priority:** P2 (cleanup -- only after importer fix is proven)
**Blocked by:**
  - Importer fix (`~/goliath/mirror-node-0149-publish-1` task-002) deployed to FRA
  - FRA canary stable for 24h (no mirror nonce <-> consensus nonce divergence)
  - Historical backfill complete (task-003 from parent issue)
**Blocks:** Nothing
**Estimated time:** 3-4 hours
**Branch:** `fix/remove-nonce-floor` (from whatever branch has subtask-001 merged)

---

## Context

The nonce floor (`getContractResultNonceFloor()`) was added as a compensating mechanism
for stale mirror `ethereum_nonce`. It queries `contracts/results?from=<addr>` to find
the last successful nonce, adds 1, and uses `Math.max(mirrorNonce, nonceFloor)` as the
effective nonce.

Once the importer fix makes mirror `ethereum_nonce` authoritative (advances nonce for
INSUFFICIENT_GAS and other nonce-consuming failures), this floor is no longer needed.
Keeping it adds:
- Extra mirror API call per `eth_getTransactionCount` request
- Cache management complexity
- A secondary nonce authority that can itself become stale
- Divergence from upstream relay behavior

Upstream relay behavior (which solo uses successfully):
- `eth_getTransactionCount("latest")` = mirror `ethereum_nonce`
- `eth_getTransactionCount("pending")` = mirror `ethereum_nonce` + tx-pool pending count

This is the target state after this subtask.

---

## Pre-Conditions (Must Be Met Before Starting)

1. **Importer fix deployed to FRA:** The `fix-mirror-bridge-0149` (or later) importer
   image is running on FRA K3s and processing new blocks without errors.

2. **24h canary stable:** For all active EVM senders on FRA mirror:
   ```sql
   -- Run on FRA mirror PostgreSQL
   -- All accounts should have consensus nonce = mirror nonce
   SELECT e.num, e.ethereum_nonce AS mirror_nonce
   FROM entity e
   WHERE e.type = 'ACCOUNT' AND e.ethereum_nonce > 0
   ORDER BY e.num;
   ```
   Cross-reference with consensus HAPI nonce (via `goliath-nonce-reconcile` timer output).
   Zero divergence for 24h confirms the importer is authoritative.

3. **Historical backfill complete:** All accounts with prior INSUFFICIENT_GAS gaps have
   been corrected via the nonce reconciliation script. No stale nonces remain.

---

## What to Change

### File 1: `packages/relay/src/lib/services/ethService/accountService/AccountService.ts`

**Remove `getContractResultNonceFloor()` method (lines 457-484):**

Delete the entire method:
```typescript
  // DELETE lines 457-484 (the entire getContractResultNonceFloor method)
```

**Simplify `getAccountLatestEthereumNonce()` (lines 421-442):**

Before (current):
```typescript
  private async getAccountLatestEthereumNonce(address: string, requestDetails: RequestDetails): Promise<string> {
    const accountData = await this.mirrorNodeClient.getAccount(address, requestDetails);
    if (accountData) {
      const mirrorNonce = accountData.ethereum_nonce !== null ? accountData.ethereum_nonce : 1;
      const nonceFloor = await this.getContractResultNonceFloor(address, requestDetails);
      const effectiveNonce = Math.max(mirrorNonce, nonceFloor);
      this.logger.info(
        `[NONCE-FLOOR] address=${address} mirrorNonce=${mirrorNonce} nonceFloor=${nonceFloor} effectiveNonce=${effectiveNonce}`,
      );
      return numberTo0x(effectiveNonce);
    }
    return constants.ZERO_HEX;
  }
```

After (simplified):
```typescript
  private async getAccountLatestEthereumNonce(address: string, requestDetails: RequestDetails): Promise<string> {
    const accountData = await this.mirrorNodeClient.getAccount(address, requestDetails);
    if (accountData) {
      // With HIP-729, ethereum_nonce should always be 0+. Historical contracts may
      // have null as nonce was not tracked -- return EVM-compliant 0x1 in that case.
      const mirrorNonce = accountData.ethereum_nonce !== null ? accountData.ethereum_nonce : 1;
      return numberTo0x(mirrorNonce);
    }
    return constants.ZERO_HEX;
  }
```

### File 2: `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts`

**Remove nonce floor cache update (lines 849-860):**

Before (current):
```typescript
    // Update the nonce floor cache so the next eth_getTransactionCount call returns the
    // correct next nonce even before the mirror catches up. This closes the window where
    // back-to-back sends fail because both mirror account and contract_results endpoints
    // still reflect the pre-submission state.
    if (parsedTx.from && parsedTx.nonce != null) {
      const floorKey = `${constants.CACHE_KEY.NONCE_FLOOR}_${parsedTx.from.toLowerCase()}`;
      const newFloor = parsedTx.nonce + 1;
      try {
        const existingFloor = await this.cacheService.getAsync(floorKey, 'updateNonceFloor');
        if (existingFloor == null || Number(existingFloor) < newFloor) {
          await this.cacheService.set(floorKey, newFloor, 'updateNonceFloor', constants.NONCE_FLOOR_CACHE_TTL_MS);
        }
      } catch (e: any) {
        this.logger.debug(`Failed to update nonce floor for ${parsedTx.from}: ${e.message}`);
      }
    }
```

After: Delete this entire block. The Redis tx-pool already handles the back-to-back
send case via `eth_getTransactionCount("pending")` = mirror + pool count.

**Also simplify `handleSubmissionError()` WRONG_NONCE block (lines 924-930):**

After subtask-001, this block has the floor-aware logic. Once the floor is removed,
revert to the simpler raw-mirror approach (which is now correct because mirror is
authoritative):

```typescript
        let accountNonce: number | null = null;
        try {
          accountNonce = (await this.mirrorNodeClient.getAccount(parsedTx.from!, requestDetails))?.ethereum_nonce;
        } catch (mirrorNodeError) {
          this.logger.debug(mirrorNodeError, `Failed to fetch account nonce for WRONG_NONCE error handling`);
        }
```

This is exactly the original code -- but now it is correct because the mirror is
authoritative.

### File 3: `packages/relay/src/lib/constants.ts`

**Remove nonce floor constants:**

Delete:
```typescript
  NONCE_FLOOR = 'nonce_floor',          // line 27 in CACHE_KEY enum
```

Delete:
```typescript
  NONCE_FLOOR_CACHE_TTL_MS: 15000,      // line 112
```

### File 4: `packages/relay/tests/lib/eth/eth_getTransactionCount.spec.ts`

**Remove nonce floor mock setup (line 66):**

Delete:
```typescript
    restMock.onGet(contractResultsByFromPath).reply(200, JSON.stringify({ results: [], links: { next: null } }));
```

And remove the `contractResultsByFromPath` constant (line 50):
```typescript
    const contractResultsByFromPath = `contracts/results?from=${MOCK_ACCOUNT_ADDR}&limit=1&order=desc`;
```

Review all tests in this file -- they should still pass because the mock was returning
empty results (floor=0), so `Math.max(mirrorNonce, 0) = mirrorNonce`. After removal,
the result is the same.

### File 5: `packages/relay/tests/lib/eth/eth_sendRawTransaction.spec.ts`

**Update WRONG_NONCE tests:**

The tests added in subtask-001 (stale mirror + floor higher) should be replaced with
simpler tests that only use raw mirror nonce. The "floor fallback" test is deleted
entirely since there is no floor.

**Update or remove:** Test A from subtask-001 (floor-based classification) -- no longer
applicable. Replace with a test that confirms raw mirror is used directly.

**Keep:** Test B concept (mirror request fails => falls through to TRANSACTION_REJECTED)
but remove the floor-specific language.

---

## Exact Line References

| File | Line(s) | Action |
|------|---------|--------|
| `AccountService.ts` | 427-436 | Simplify (remove floor call and logging) |
| `AccountService.ts` | 457-484 | Delete entire `getContractResultNonceFloor()` method |
| `TransactionService.ts` | 849-860 | Delete nonce floor cache update block |
| `TransactionService.ts` | 924-930 | Simplify handleSubmissionError to raw mirror (revert subtask-001 floor addition) |
| `constants.ts` | 27 | Delete `NONCE_FLOOR` from CACHE_KEY enum |
| `constants.ts` | 112 | Delete `NONCE_FLOOR_CACHE_TTL_MS` |
| `eth_getTransactionCount.spec.ts` | 50 | Delete `contractResultsByFromPath` |
| `eth_getTransactionCount.spec.ts` | 66 | Delete nonce floor mock |
| `eth_sendRawTransaction.spec.ts` | subtask-001 tests | Replace floor-based tests with direct mirror tests |

---

## Build and Test

```bash
cd ~/goliath/json-rpc-relay

# Create branch from current main (which has subtask-001 merged)
git checkout -b fix/remove-nonce-floor

# Run affected test files
npx mocha --require ts-node/register --timeout 10000 \
  packages/relay/tests/lib/eth/eth_getTransactionCount.spec.ts \
  packages/relay/tests/lib/eth/eth_sendRawTransaction.spec.ts

# Run full relay test suite
npm run test --workspace=packages/relay

# Verify no remaining references to nonce floor
grep -r 'NONCE_FLOOR\|nonceFloor\|nonce_floor\|getContractResultNonceFloor' packages/relay/src/
# Expected: zero matches

# Build image
docker build --platform linux/amd64 -t ghcr.io/onyx-protocol/goliath-relay:remove-nonce-floor .
```

---

## Deployment

Same pod-by-pod rolling strategy as subtask-001. FRA first, then ASH/TYO after 1h soak.

Post-deployment verification:
```bash
# Verify nonce is correct for previously-stale accounts
curl -sS https://rpc.goliath.net \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":["0x1337843dF13A3d6edbB3dAD99A6cB3851da3e771","latest"]}'
# Expected: 0x4 (from authoritative mirror, not from floor)

# Verify pending still works
curl -sS https://rpc.goliath.net \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":["0x1337843dF13A3d6edbB3dAD99A6cB3851da3e771","pending"]}'
```

---

## Acceptance Checklist

- [ ] Pre-condition met: importer fix deployed to FRA for 24h+ with zero nonce divergence
- [ ] Pre-condition met: historical nonce backfill complete
- [ ] `getContractResultNonceFloor()` deleted from AccountService
- [ ] Nonce floor cache update deleted from TransactionService
- [ ] `NONCE_FLOOR` and `NONCE_FLOOR_CACHE_TTL_MS` deleted from constants
- [ ] `getAccountLatestEthereumNonce()` returns raw mirror nonce (no floor)
- [ ] `handleSubmissionError()` uses raw mirror nonce (no floor)
- [ ] `grep -r 'NONCE_FLOOR\|nonceFloor\|nonce_floor\|getContractResultNonceFloor'` returns zero matches in `packages/relay/src/`
- [ ] All relay tests pass (updated where needed)
- [ ] `eth_getTransactionCount("latest")` = mirror nonce (upstream behavior)
- [ ] `eth_getTransactionCount("pending")` = mirror nonce + tx-pool count (upstream behavior)
- [ ] FRA canary: 30-minute soak, no WRONG_NONCE regressions
- [ ] ASH/TYO deployed after FRA soak
