# Task 004: Redeploy MasterChef and Verify

## Context

- Existing MasterChef addresses were deployed while the relay bug was live:
  - `0x2af25B155c0F2272D31dA6F2fd08EbefB11a2A6c`
  - `0xb93cDdcF726189BC9737255F0a2e9484FEF46e83`
- Both addresses are misindexed on Blockscout and should not be treated as recoverable without external autoscout support
- The authoritative deploy script is `~/goliath/wXCN/scripts/deploy-masterchef-mainnet.ts`
- On Goliath, ethers may report a CREATE-predicted address that differs from the real deployed address; the script already treats `receipt.contractAddress` as authoritative
- On Goliath, the pool-add transaction needs explicit `gasLimit: 1000000`

## Task

After the relay fix is live and verified, deploy a fresh MasterChef and confirm Blockscout now sees the deploy transaction as the creation transaction.

Required work:

- Run `cd ~/goliath/wXCN && npx hardhat run scripts/deploy-masterchef-mainnet.ts --network mainnet`
- If needed, supply `NONCE_START=<current nonce>` as documented by the script
- Treat the address from `receipt.contractAddress` and the deployment artifact as canonical if it differs from the predicted CREATE address
- Confirm the script writes `deployments/mainnet-masterchef.json`
- Verify the new address via:
  - explorer API `creation_transaction_hash`
  - explorer API `creation_bytecode`
  - deployment artifact `verification.status`
  - `npx hardhat verify --network mainnet --contract contracts/MasterChef.sol:MasterChef <address> <wxcn> <xcnPerSecond> <startTime>`
- Do not fund the contract or update frontend references until verification succeeds

## Blockers

- `task-003-deploy-relay-and-verify-receipts.md` — do not redeploy MasterChef until the relay fix is live and proven

## Acceptance Checklist

- [ ] New MasterChef deploy succeeds and pool 0 is added
- [ ] Canonical deployed address comes from `receipt.contractAddress` / artifact, not ethers' predicted address
- [ ] Pool add uses explicit `gasLimit: 1000000`
- [ ] `deployments/mainnet-masterchef.json` reflects the fresh verified address
- [ ] `deployments/mainnet-masterchef.json` contains the final `verification.status`
- [ ] Explorer `creation_transaction_hash` equals the deploy tx hash
- [ ] Explorer `creation_bytecode` is initcode, not short `add()` calldata
- [ ] `hardhat verify` succeeds for the fresh address
- [ ] Old bad MasterChef addresses are not reused
- [ ] Code or config follows the project's style and safety rules
