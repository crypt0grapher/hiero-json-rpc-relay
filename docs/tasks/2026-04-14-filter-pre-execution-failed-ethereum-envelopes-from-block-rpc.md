# Filter Pre-Execution Failed Ethereum Envelopes From Block RPC

**Project:** Goliath JSON-RPC Relay
**Type:** Compatibility Fix | Blockscout Integration
**Priority:** P1
**Risk level:** Medium
**Requires deployment?:** Yes
**Requires network freeze?:** No
**Owner:** Goliath Engineering
**Date created:** 2026-04-14
**Related docs / prior issues:** `~/goliath/mainnet/docs/issues/2026-04-14-blockscout-pending-tx-loop-failed-eth-hash-receipt-race.md`, `packages/config-service/src/services/globalConfig.ts`, `packages/relay/src/utils.ts`

---

## 1) GOAL / SUCCESS CRITERIA

- [ ] Relay excludes pre-execution failed Ethereum envelopes from block-facing RPC outputs
- [ ] Blockscout no longer receives the failed-fee envelopes that trigger per-hash receipt retries
- [ ] The status filter remains explicit and test-covered

---

## 2) IMPLEMENTED CODE CHANGE

### File changed

- `packages/config-service/src/services/globalConfig.ts`

### Added statuses

- `INVALID_NODE_ACCOUNT`
- `TRANSACTION_EXPIRED`
- `INSUFFICIENT_TX_FEE`
- `INSUFFICIENT_PAYER_BALANCE`
- `DUPLICATE_TRANSACTION`

These statuses now join the existing `HEDERA_SPECIFIC_REVERT_STATUSES` default list, so `Utils.isRejectedDueToHederaSpecificValidation()` removes them from:

- `eth_getBlockByNumber`
- `eth_getBlockByHash`
- `eth_getBlockReceipts`
- downstream transaction array preparation based on the same helper

---

## 3) LOCAL VERIFICATION

### Passed locally

- `cd packages/config-service && npm run build`
- `cd packages/relay && npx ts-mocha ./tests/lib/utils.spec.ts --exit`

The `utils.spec.ts` matrix confirmed the new statuses are treated as rejected-by-Hedera validation and therefore filtered before EVM-style block presentation.

---

## 4) DEPLOYMENT PLAN

### Pre-flight

1. Confirm runtime manifests are **not** overriding `HEDERA_SPECIFIC_REVERT_STATUSES`
2. If any env override exists in testnet or mainnet, update that manifest/config before rollout or the image default will not take effect

### Testnet

1. Merge branch `fix/blockscout-failed-eth-hash-receipts` to `main`
2. Build/publish relay image from `main`
3. Roll relay pods one-by-one
4. Verify failed-fee Ethereum envelopes disappear from `eth_getBlockByNumber` and `eth_getBlockReceipts`

### Mainnet

1. FRA canary first
2. Roll relay pods one-by-one; do not use mass restart patterns
3. Verify public `rpc.goliath.net` output on the known reproducer block
4. Continue to ASH then TYO

---

## 5) RPC VERIFICATION

### Reproducer block

```bash
curl -s https://rpc.goliath.net -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["0x1d1509",false]}'
curl -s https://rpc.goliath.net -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockReceipts","params":["0x1d1509"]}'
```

Expected after rollout:

- the `INSUFFICIENT_TX_FEE` Ethereum envelopes are absent from block-facing responses
- successful/executed EVM transactions remain unaffected

---

## 6) ROLLBACK

- Revert to the prior relay image digest
- Continue pod-by-pod rollback discipline
- If a manifest override was added for the status list, revert that manifest at the same time as the image rollback

