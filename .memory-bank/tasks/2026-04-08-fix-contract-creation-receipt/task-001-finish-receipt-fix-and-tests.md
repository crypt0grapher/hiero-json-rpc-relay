# Task 001: Finish Receipt Fix and Tests

## Context

- The relay worktree already contains unstaged source edits in three files:
  - `packages/relay/src/lib/factories/transactionReceiptFactory.ts`
  - `packages/relay/src/lib/services/ethService/transactionService/TransactionService.ts`
  - `packages/relay/src/lib/types/ITransactionReceipt.ts`
- Root cause: the relay leaked `contractAddress` into non-creation receipts, which broke Blockscout creation indexing
- The current targeted baseline is `33 passing`, `6 failing`
- This task owns only the code and tests inside `~/goliath/json-rpc-relay`

## Task

Finalize the existing receipt fix and bring the narrow regression suite to green.

Required work:

- Preserve the current unstaged source diff; do not overwrite it blindly
- Update `packages/relay/tests/lib/eth/eth_getTransactionReceipt.spec.ts` so non-creation fixtures expect `contractAddress: null`
- Add or adjust direct-deploy coverage in `packages/relay/tests/lib/factories/transactionReceiptFactory.spec.ts`
- Update `packages/relay/tests/lib/eth/eth_getBlockReceipts.spec.ts` so creation vs non-creation expectations match the new semantics
- Fix the timeout/cascading Sinon stub failures in the affected receipt specs
- Run:
  - `cd packages/relay && npx ts-mocha --recursive './tests/lib/factories/transactionReceiptFactory.spec.ts' './tests/lib/eth/eth_getTransactionReceipt.spec.ts' './tests/lib/eth/eth_getBlockReceipts.spec.ts' --exit`
  - `npm run build`

## Blockers

- No blockers

## Acceptance Checklist

- [ ] Only real creation receipts return a non-null `contractAddress`
- [ ] Direct deploys null the `to` field and expose the deployed `contractAddress`
- [ ] HTS creation behavior still works
- [ ] Targeted receipt regression suite passes
- [ ] `npm run build` passes
- [ ] Code or config follows the project's style and safety rules

