# Subtask 001: Fix handleSubmissionError Nonce Comparison

**Status:** COMPLETED (2026-03-30, deployed sha256:3d8804e8...)
**Priority:** P0 (IMMEDIATE -- users are deadlocked)
**Blocked by:** Nothing
**Blocks:** Subtask 003 (nonce floor removal uses this as stepping stone)
**Estimated time:** 2-3 hours
**Branch:** `fix/handle-submission-error-nonce` (from current `main`)

---

## Context

When consensus returns WRONG_NONCE, the relay's `handleSubmissionError()` fetches the
raw mirror nonce to classify the error as NONCE_TOO_HIGH or NONCE_TOO_LOW. But the
mirror nonce can be stale (e.g., mirror=1, consensus=4) because the importer does not
advance nonce for INSUFFICIENT_GAS failures. The relay's `getAccountLatestEthereumNonce()`
applies a nonce floor from contract results, but `handleSubmissionError()` bypasses this
entirely, creating a split authority that deadlocks users.

**Live reproduction (0.0.1267 on 2026-03-30):**
- Mirror nonce: 1 (stale), Consensus nonce: 4
- User sends nonce=3 => precheck passes => consensus WRONG_NONCE => handleSubmissionError
  gets mirror nonce=1 => `3 > 1` => throws "Nonce too high"
- User retries nonce=1 => consensus WRONG_NONCE (expects 4)
- No valid nonce: user completely locked out

---

## What to Change

### File 1: `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts`

**Location:** `handleSubmissionError()` method, lines 918-940

**Current code (line 924-926):**
```typescript
        let accountNonce: number | null = null;
        try {
          accountNonce = (await this.mirrorNodeClient.getAccount(parsedTx.from!, requestDetails))?.ethereum_nonce;
```

**Problem:** Uses raw mirror `ethereum_nonce` which may be stale.

**Fix:** Use the AccountService's `getAccountLatestEthereumNonce()` which applies the
nonce floor, or replicate the floor logic inline. The AccountService method is private
and returns a hex string, so the cleanest approach is to replicate the floor lookup.

**Proposed change (replace lines 924-930):**

```typescript
        let accountNonce: number | null = null;
        try {
          const accountData = await this.mirrorNodeClient.getAccount(parsedTx.from!, requestDetails);
          if (accountData) {
            const mirrorNonce = accountData.ethereum_nonce !== null ? accountData.ethereum_nonce : 1;

            // Apply nonce floor from latest contract result, matching the logic in
            // AccountService.getAccountLatestEthereumNonce(). Without this, a stale
            // mirror nonce causes misclassification: correct nonces appear "too high"
            // and the user is deadlocked.
            let nonceFloor = 0;
            try {
              const results = await this.mirrorNodeClient.getContractResults(
                requestDetails,
                { from: parsedTx.from! },
                { limit: 1, order: constants.ORDER.DESC },
              );
              if (Array.isArray(results) && results.length > 0 && results[0].nonce != null) {
                nonceFloor = results[0].nonce + 1;
              }
            } catch (floorError: any) {
              // Floor lookup failed -- fall back to mirror nonce only (existing behavior).
              this.logger.debug(`Failed to get nonce floor for WRONG_NONCE handler: ${floorError.message}`);
            }

            accountNonce = Math.max(mirrorNonce, nonceFloor);
          }
        } catch (mirrorNodeError) {
```

**Why this approach instead of calling AccountService:**
1. `getAccountLatestEthereumNonce()` is a private method on AccountService
2. TransactionService does not hold a reference to AccountService
3. The floor logic is 10 lines -- duplication is acceptable for a fix that will be
   removed entirely in Subtask 003 when the nonce floor is deleted
4. Adding a cross-service dependency for temporary code is not justified

### File 2: `packages/relay/tests/lib/eth/eth_sendRawTransaction.spec.ts`

**Location:** Inside the `WRONG_NONCE Error Handling` describe block (line 1136)

**New tests to add after the existing "should throw NONCE_TOO_LOW" test (after line 1212):**

**Test A: Stale mirror nonce + nonce floor higher => uses floor for classification**
```typescript
it('should use nonce floor when mirror nonce is stale for WRONG_NONCE classification', async function () {
  // Transaction with nonce 3 (correct for consensus, but mirror is stale at 1)
  const txWithNonce = { ...transaction, nonce: 3 };
  const signed = await signTransaction(txWithNonce);

  const wrongNonceError = new SDKClientError(
    { status: Status.WrongNonce, message: 'WRONG_NONCE' },
    'WRONG_NONCE',
    transactionIdServicesFormat,
  );
  sdkClientStub.submitEthereumTransaction.throws(wrongNonceError);

  restMock.resetHistory();
  // Mirror nonce is stale at 1
  restMock.onGet(accountEndpoint).reply(200, JSON.stringify({ ...ACCOUNT_RES, ethereum_nonce: 1 }));
  // Contract results show nonce 3 was last successful => floor = 4
  restMock.onGet(/contracts\/results\?from=/).reply(200, JSON.stringify({
    results: [{ nonce: 3 }],
    links: { next: null },
  }));

  // With floor = 4, parsedTx.nonce (3) < accountNonce (4) => NONCE_TOO_LOW
  // Without the fix, it would be NONCE_TOO_HIGH because 3 > 1 (raw mirror)
  await expect(ethImpl.sendRawTransaction(signed, requestDetails))
    .to.be.rejectedWith(JsonRpcError)
    .and.eventually.satisfy(
      (error: JsonRpcError) =>
        expect(error.code).to.equal(predefined.NONCE_TOO_LOW(3, 4).code) &&
        expect(error.message).to.include('Nonce too low'),
    );
});
```

**Test B: Nonce floor query fails => falls back to raw mirror (graceful degradation)**
```typescript
it('should fall back to raw mirror nonce when contract results query fails in WRONG_NONCE handler', async function () {
  // Transaction with nonce 10, mirror nonce 5
  const txWithNonce = { ...transaction, nonce: 10 };
  const signed = await signTransaction(txWithNonce);

  const wrongNonceError = new SDKClientError(
    { status: Status.WrongNonce, message: 'WRONG_NONCE' },
    'WRONG_NONCE',
    transactionIdServicesFormat,
  );
  sdkClientStub.submitEthereumTransaction.throws(wrongNonceError);

  restMock.resetHistory();
  // Mirror nonce is 5
  restMock.onGet(accountEndpoint).reply(200, JSON.stringify({ ...ACCOUNT_RES, ethereum_nonce: 5 }));
  // Contract results endpoint fails with 500
  restMock.onGet(/contracts\/results\?from=/).reply(500);

  // Floor lookup fails, falls back to mirror nonce (5). tx nonce 10 > 5 => NONCE_TOO_HIGH
  await expect(ethImpl.sendRawTransaction(signed, requestDetails))
    .to.be.rejectedWith(JsonRpcError)
    .and.eventually.satisfy(
      (error: JsonRpcError) =>
        expect(error.code).to.equal(predefined.NONCE_TOO_HIGH(10, 5).code) &&
        expect(error.message).to.include('Nonce too high'),
    );
});
```

**Test C: Nonce floor matches mirror => no change from existing behavior**
```typescript
it('should use mirror nonce when nonce floor equals mirror nonce for WRONG_NONCE', async function () {
  // Transaction with nonce 10, mirror nonce 5, floor also 5
  const txWithNonce = { ...transaction, nonce: 10 };
  const signed = await signTransaction(txWithNonce);

  const wrongNonceError = new SDKClientError(
    { status: Status.WrongNonce, message: 'WRONG_NONCE' },
    'WRONG_NONCE',
    transactionIdServicesFormat,
  );
  sdkClientStub.submitEthereumTransaction.throws(wrongNonceError);

  restMock.resetHistory();
  restMock.onGet(accountEndpoint).reply(200, JSON.stringify({ ...ACCOUNT_RES, ethereum_nonce: 5 }));
  // Contract results show nonce 4 => floor = 5 (matches mirror)
  restMock.onGet(/contracts\/results\?from=/).reply(200, JSON.stringify({
    results: [{ nonce: 4 }],
    links: { next: null },
  }));

  // max(mirror=5, floor=5) = 5. tx nonce 10 > 5 => NONCE_TOO_HIGH (same as before)
  await expect(ethImpl.sendRawTransaction(signed, requestDetails))
    .to.be.rejectedWith(JsonRpcError)
    .and.eventually.satisfy(
      (error: JsonRpcError) =>
        expect(error.code).to.equal(predefined.NONCE_TOO_HIGH(10, 5).code) &&
        expect(error.message).to.include('Nonce too high'),
    );
});
```

---

## Exact Line References

| File | Line(s) | What |
|------|---------|------|
| `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts` | 918 | Start of WRONG_NONCE handling block |
| Same | 924-926 | `accountNonce` fetched from raw mirror -- **THE BUG** |
| Same | 934-940 | nonce comparison and NONCE_TOO_HIGH/LOW throw |
| Same | 849-860 | Nonce floor cache update after successful tx (keep for now, remove in subtask-003) |
| `packages/relay/src/lib/services/ethService/accountService/AccountService.ts` | 421-442 | `getAccountLatestEthereumNonce()` -- the correct authority (uses floor) |
| Same | 457-484 | `getContractResultNonceFloor()` -- the floor logic to replicate |
| `packages/relay/src/lib/precheck.ts` | 102 | Precheck uses raw mirror nonce (secondary issue, does not deadlock) |
| `packages/relay/tests/lib/eth/eth_sendRawTransaction.spec.ts` | 1136-1282 | Existing WRONG_NONCE test block |

---

## Build and Test

```bash
cd ~/goliath/json-rpc-relay

# Create branch
git checkout -b fix/handle-submission-error-nonce

# Run the specific test file
npx mocha --require ts-node/register --timeout 10000 \
  packages/relay/tests/lib/eth/eth_sendRawTransaction.spec.ts

# Run the full relay test suite
npm run test --workspace=packages/relay

# Build the Docker image
docker build --platform linux/amd64 -t ghcr.io/onyx-protocol/goliath-relay:handle-submission-error-nonce .
```

---

## Deployment

After tests pass, deploy to FRA canary first:

```bash
KUBECONFIG=~/.kube/goliath-fra.yaml

# Push image
docker push ghcr.io/onyx-protocol/goliath-relay:handle-submission-error-nonce

# Update relay-http pods one at a time
for pod in $(kubectl get pods -n goliath-relay -l app=relay-http -o name | head -1); do
  kubectl set image -n goliath-relay deployment/relay-http relay-http=ghcr.io/onyx-protocol/goliath-relay:handle-submission-error-nonce
  # Wait for rollout (one pod at a time via maxUnavailable=1)
  kubectl rollout status -n goliath-relay deployment/relay-http --timeout=120s
done

# Repeat for relay-ws, relay-internal-http, relay-internal-ws
```

FRA canary verification:
```bash
# Test with known stale-nonce account (if one exists) or dev account
curl -sS https://rpc.goliath.net \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":["0x1337843dF13A3d6edbB3dAD99A6cB3851da3e771","latest"]}'
```

---

## Acceptance Checklist

- [ ] Existing 4 WRONG_NONCE tests pass unchanged
- [ ] New Test A: stale mirror + floor higher => uses floor for WRONG_NONCE classification
- [ ] New Test B: floor query fails => graceful fallback to raw mirror
- [ ] New Test C: floor matches mirror => no behavior change
- [ ] Full relay test suite passes
- [ ] FRA canary: no deadlock for stale-nonce accounts
- [ ] No regressions in fee handling, chain ID, gas price, or receipt format
