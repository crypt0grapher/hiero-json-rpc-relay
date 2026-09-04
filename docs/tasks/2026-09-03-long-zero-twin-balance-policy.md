# Long-zero twin balance policy (`LONG_ZERO_TWIN_POLICY`) — code repo subtask

**Parent orchestrator:** `/Users/alex/goliath/mainnet/docs/tasks/2026-09-03-relay-long-zero-twin-balance-policy.md`

## Goal
Add a flag-gated guard to `AccountService.getBalance`: when `LONG_ZERO_TWIN_POLICY=balance` and the input is the long-zero form of an entity whose mirror `evm_address` is a different canonical address, return `0x0` (`observe` → real balance + counter; default `off` → byte-identical responses). Fail-open on mirror errors; keep-list accounts (`evm_address == long-zero`) unaffected; metrics `rpc_relay_long_zero_twin_total{method,decision,ua_class}` and `rpc_relay_long_zero_twin_policy_mode{mode}`; long-zero `eth_getBalance` inputs bypass the shared Redis cache (read+write) in every mode.

## Branch baseline (deliberate exception)
Cut `hotfix/long-zero-twin-balance-policy` from the LIVE commit `c934abd485d0a16d86517d631ee03ce7d9b10f41`, not `origin/main` — `main` carries the HELD nonce-preflight change (`c31727d4`) whose canary regressed. Push the hotfix ref to origin, then build the deploy image from it via `workflow_dispatch`; PR the same change into `main` separately.

## Execution pointer
Execute **only** the parent orchestrator file via `/dotask --fast docs/tasks/2026-09-03-relay-long-zero-twin-balance-policy.md` from `~/goliath/mainnet`. There are no memory-bank tasks and no `task-NNN` decomposition; parent §8 P0–P12 is the whole plan. The parent's §6.3 lists every file this repo touches (including `cache.decorator.ts`, `RequestDetails.ts`, and `koaJsonRpc/index.ts` — added in plan_version 3).

## Non-goals
No change to `eth_getCode`, `eth_getTransactionCount`, `eth_call`, traces or block/receipt/log surfaces; no deployment from this repo task alone (orchestrated by the parent).

---
Generated: 2026-09-04 21:50 CEST
Model: kimi-k3 (Kimi Code CLI)
Thinking effort: not-reported
---
