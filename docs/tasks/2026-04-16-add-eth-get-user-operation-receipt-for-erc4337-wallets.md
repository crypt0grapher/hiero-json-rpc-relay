# Add `eth_getUserOperationReceipt` for ERC-4337 Wallet Compatibility

**Project:** Goliath JSON-RPC Relay
**Type:** Compatibility Fix | ERC-4337 | Wallet Infrastructure
**Priority:** P1
**Risk level:** Medium
**Requires deployment?:** Yes
**Requires network freeze?:** No
**Owner:** Goliath Engineering
**Date created:** 2026-04-16
**Related docs / prior issues:**
- `~/goliath/mainnet/docs/issues/2026-04-16-mainnet-erc4337-userop-receipt-rpc-gap.md`
- `~/goliath/mainnet/docs/issues/2026-04-15-userop-failed-thirdweb-native-value-unit-mismatch.md`
- `~/goliath/mainnet/docs/tids/2026-04-13-restore-handleops-contract-logs-bloom-gasused-for-erc4337.md`
- `docs/openrpc.json`

---

## 1) GOAL / SUCCESS CRITERIA

- [ ] Relay exposes `eth_getUserOperationReceipt`
- [ ] The method returns `null` for a non-indexed `userOpHash`
- [ ] For an indexed `userOpHash`, the method returns:
  - `receipt`
  - `logs`
  - `userOpHash`
  - `entryPoint`
  - `sender`
  - `nonce`
  - `paymaster`
  - `actualGasUsed`
  - `actualGasCost`
  - `success`
- [ ] Failed user ops include the raw revert bytes in `reason` when `UserOperationRevertReason` is present
- [ ] thirdweb-style clients can call `eth_getUserOperationReceipt` and unwrap `res.receipt` without a generic 500

---

## 2) IMPLEMENTED CODE CHANGE

### Files changed

- `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts`
- `packages/relay/src/lib/services/ethService/transactionService/ITransactionService.ts`
- `packages/relay/src/lib/eth.ts`
- `packages/relay/src/index.ts`
- `packages/relay/src/lib/types/IUserOperationReceipt.ts`
- `packages/relay/src/lib/types/index.ts`
- `packages/relay/src/lib/config/methodConfiguration.ts`
- `packages/relay/tests/lib/eth/eth_getUserOperationReceipt.spec.ts`
- `docs/openrpc.json`

### Behavior

- The relay now locates `UserOperationEvent` by `topic0` + `topic1=userOpHash`
- It decodes the EntryPoint event using the canonical ERC-4337 event signature
- It reuses the already-working `eth_getTransactionReceipt` pipeline to build the embedded `receipt`
- It returns the thirdweb-compatible wrapper object:
  - `receipt`
  - `logs`
  - `userOpHash`
  - `entryPoint`
  - `sender`
  - `nonce`
  - `paymaster`
  - `actualGasUsed`
  - `actualGasCost`
  - `success`
  - optional `reason`

### Explicit non-change

- This task does **not** add a full bundler
- This task does **not** add `eth_sendUserOperation`
- This task does **not** change mirror-node indexing or consensus behavior

---

## 3) LOCAL VERIFICATION

### Passed locally

- `cd ~/goliath/json-rpc-relay/packages/relay && npx ts-mocha --recursive './tests/lib/eth/eth_getUserOperationReceipt.spec.ts' --exit`
- `cd ~/goliath/json-rpc-relay/packages/relay && npx ts-mocha --recursive './tests/lib/eth/eth_getTransactionReceipt.spec.ts' --exit`
- `cd ~/goliath/json-rpc-relay/packages/relay && npx ts-mocha './tests/lib/openrpc.spec.ts' --exit -g 'validates the openrpc document'`
- `cd ~/goliath/json-rpc-relay && npx eslint packages/relay/src/index.ts packages/relay/src/lib/eth.ts packages/relay/src/lib/config/methodConfiguration.ts packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts packages/relay/src/lib/services/ethService/transactionService/ITransactionService.ts packages/relay/src/lib/types/IUserOperationReceipt.ts packages/relay/src/lib/types/index.ts packages/relay/tests/lib/eth/eth_getUserOperationReceipt.spec.ts`

### Covered scenarios

- Returns `null` when no matching `UserOperationEvent` exists
- Returns a successful wrapped receipt
- Returns a failed wrapped receipt plus `reason` when `UserOperationRevertReason` is present
- Existing `eth_getTransactionReceipt` behavior remains green

---

## 4) DEPLOYMENT PLAN

### Current production rollback image

Observed during the 2026-04-16 investigation:

- `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:main@sha256:cdf5c5c7c7f5d9271738add21180ce5fa0b034867f792cdd52419cbb62c1bcaf`

### Pre-flight

1. Record the currently deployed image again on FRA / ASH / TYO before rollout
2. Prepare exact rollback commands using the current digest above
3. Confirm no manifest-level override disables this method or swaps router targets away from the updated relay pods

### Build / publish

1. Merge the fix branch to `main`
2. Push `main` to `origin`
3. Wait for `.github/workflows/build-relay.yaml` to publish the new `:main` digest
4. Capture the new digest for both rollout and rollback notes

### Mainnet rollout

1. FRA canary first
2. Update `relay-http` image in FRA
3. Validate `eth_getUserOperationReceipt` on the known historical reproducer
4. If clean, update FRA `relay-ws`
5. Soak for 30 minutes
6. Roll ASH
7. Roll TYO
8. Maintain normal pod-by-pod discipline; do **not** use mass restart shortcuts

### Smoke tests after each region

```bash
curl -s https://rpc.goliath.net -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getUserOperationReceipt","params":["0x0f65f168dd7c90ee91d8c350c9ba2a265b666119bf80b12eccc54a0f3ff73c48"]}'

curl -s https://rpc.goliath.net -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0xaa71f6bb57b565d341d730e547b3fa6496be91131011468334c80f529b1578bf"]}'
```

Expected after rollout:

- `eth_getUserOperationReceipt` returns a JSON-RPC `result`, not `-32601`
- `result.receipt.transactionHash == 0xaa71f6bb57b565d341d730e547b3fa6496be91131011468334c80f529b1578bf`
- `result.success == true`
- `result.sender == 0x6D495cF76114c707fe8b14745e20c8caeA534469`

---

## 5) ROLLBACK

### Relay HTTP

```bash
KUBECONFIG=~/.kube/goliath-fra.yaml kubectl set image deploy/relay-http -n goliath-relay \
  relay-http=ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:main@sha256:cdf5c5c7c7f5d9271738add21180ce5fa0b034867f792cdd52419cbb62c1bcaf
```

Repeat the same digest rollback for ASH and TYO.

### Relay WS

```bash
KUBECONFIG=~/.kube/goliath-fra.yaml kubectl set image deploy/relay-ws -n goliath-relay \
  relay-ws=ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:main@sha256:cdf5c5c7c7f5d9271738add21180ce5fa0b034867f792cdd52419cbb62c1bcaf
```

Repeat the same digest rollback for ASH and TYO.

### Rollback trigger

- Any new 5xx spike on standard receipt calls
- Any regression in `eth_getTransactionReceipt`
- Any unexpected router / websocket instability during canary

---

## 6) FOLLOW-UP

- If wallets still show intermittent post-submit failures after this deploy, investigate the separate mirror race where `transactions/<txId>?nonce=0` briefly returns `404` immediately after a successful `eth_sendRawTransaction`
- Do **not** try to solve that follow-up with scaling first; reproduce and isolate it separately
