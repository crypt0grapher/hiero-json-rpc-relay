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

- [x] Relay exposes `eth_getUserOperationReceipt`
- [x] The method returns `null` for a non-indexed `userOpHash`
- [x] For an indexed `userOpHash`, the method returns:
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
- [x] Failed user ops include the raw revert bytes in `reason` when `UserOperationRevertReason` is present
- [x] thirdweb-style clients can call `eth_getUserOperationReceipt` and unwrap `res.receipt` without a generic 500

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
- The lookup is bounded by recent timestamp windows derived from the latest mirror block so Hedera Mirror Node accepts the topic search
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
- `cd ~/goliath/json-rpc-relay/packages/relay && npm run compile`

### Covered scenarios

- Returns `null` when no matching `UserOperationEvent` exists
- Returns a successful wrapped receipt
- Returns a failed wrapped receipt plus `reason` when `UserOperationRevertReason` is present
- Widens the timestamp search window after an initial miss
- Existing `eth_getTransactionReceipt` behavior remains green

---

## 4) DEPLOYMENT STATUS

### Rollout timeline

- First rollout image:
  - `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay@sha256:ad9d4d7f58ab50a8d9511ed4d646317227114cd16c7daaad2c7dc4d93471de3e`
- First FRA canary result:
  - failed because Hedera Mirror Node rejected topic search without a timestamp range
  - error: `Cannot search topics without a valid timestamp range: No timestamp range or eq operator provided`
- Rollback image:
  - `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:main@sha256:cdf5c5c7c7f5d9271738add21180ce5fa0b034867f792cdd52419cbb62c1bcaf`
- Follow-up fix commit:
  - `13c7ad4a0ab9a3bc235d33e561cfafbce3e000f6`
- Final deployed image:
  - `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay@sha256:4a117e36c6432f27d2f3d9c67cc897eb8d3b5febc4d225342c555abe3cb76101`

### Final rollout scope

- FRA:
  - `relay-http`
  - `relay-ws`
  - `relay-internal-http`
  - `relay-internal-ws`
- ASH:
  - `relay-http`
  - `relay-ws`
  - image updated on `relay-internal-http` and `relay-internal-ws` at `0/0`
- TYO:
  - `relay-http`
  - `relay-ws`
  - image updated on `relay-internal-http` and `relay-internal-ws` at `0/0`

### Regional validation

- FRA direct service returned:
  - `result.success == true`
  - `result.receipt.transactionHash == 0xaa71f6bb57b565d341d730e547b3fa6496be91131011468334c80f529b1578bf`
  - `result.sender == 0x6D495cF76114c707fe8b14745e20c8caeA534469`
- ASH direct service returned the same expected values
- TYO direct service returned the same expected values
- Public `https://rpc.goliath.net` returned the expected receipt result **10/10** consecutive attempts

### Post-deploy notes

- No relay scaling change was needed
- The first canary failure was compatibility-related, not capacity-related
- The final rollout preserved the HIP-415 base-fee correction:
  - `eth_getBlockByNumber(...).baseFeePerGas == 0x0`
  - `eth_maxPriorityFeePerGas` continues to return gas price on Hedera

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
