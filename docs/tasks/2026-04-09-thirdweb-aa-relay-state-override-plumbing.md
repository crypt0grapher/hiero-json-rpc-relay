# Relay: Thirdweb AA and State Override Plumbing

## Context

What you need to know to complete this task:

- The remaining thirdweb partner gap is cross-component, but the relay still has two concrete responsibilities:
  - expose the correct API contract for AA simulation,
  - stop advertising `stateOverride` support unless it actually works end-to-end.
- Current evidence:
  - `packages/relay/src/lib/eth.ts:938-964` validates a third `stateOverride` param for `eth_call` but does not consume it
  - `packages/relay/src/lib/validators/types.ts:153-159` explicitly says support is not official yet
  - `packages/relay/src/lib/eth.ts:266-276` has no override path for `eth_estimateGas`
- March 31 relay fixes that must be preserved:
  - `5a574659` lazy-create gas floor `800,000`
  - `c5bb3121` nonce errors standardized to `-32000`
- The mainnet issue file is `~/goliath/mainnet/docs/issues/2026-04-09-thirdweb-aa-partner-enablement-gap.md`.
- **Current relay branch state:** `fix/authoritative-nonce-bounded-timeout` (1 commit ahead of `main` at `3edf0c40`). Branch from this state, not from `main` directly, to include the consensus-authoritative nonce fix.
- **`IContractCallRequest`** (`packages/relay/src/lib/types/mirrorNode.ts:57-67`) currently has no `stateOverride` field. Extending this interface is required if overrides are forwarded to mirror.
- The relay uses `@rpcParamValidationRules` and `@rpcParamLayoutConfig` decorators to map RPC parameters to method arguments. The `eth_call` method declares `stateOverride` as param index 2 in its validation rules but has no `@rpcParamLayoutConfig` to extract it — the parameter is validated then discarded. Adding real override support requires both decorator config and method signature changes. See `packages/relay/src/lib/decorators/rpcParamLayoutConfig.decorator.ts`.
- `mirrorNodeClient.postContractCall()` (lines 1397-1408) sends a raw `IContractCallRequest` to `/api/v1/contracts/call`. State overrides must be added to this payload if mirror supports them, or explicitly stripped with an error if not.

## Task

Update the relay so its public JSON-RPC contract matches real backend behavior for thirdweb AA flows.

Execute in this order:

1. Create `fix/thirdweb-aa-relay-contract` from the current latest state (branch `fix/authoritative-nonce-bounded-timeout` or `main` after it merges — whichever is ahead). This ensures the consensus-authoritative nonce fix is included.
2. Update relay request typing and method signatures so `eth_call` and `eth_estimateGas` intentionally accept an optional third `stateOverride` parameter:
   - `packages/relay/src/lib/eth.ts`
   - `packages/relay/src/lib/services/ethService/contractService/IContractService.ts`
   - `packages/relay/src/lib/services/ethService/contractService/ContractService.ts`
   - `packages/relay/src/lib/types/mirrorNode.ts`
   - `packages/relay/src/lib/clients/mirrorNodeClient.ts`
3. Replace the current permissive validator in `packages/relay/src/lib/validators/types.ts` with the exact mirror contract selected by the mirror task.
4. Forward supported override payloads for `eth_call` and `eth_estimateGas` only when mirror-web3 actually supports them.
5. If mirror-web3 intentionally rejects estimate-gas overrides in the first cut, reject them in relay as well instead of accepting and dropping them.
   - **If mirror state overrides are deferred entirely:** Remove the current permissive `stateOverride` validator from `eth_call` validation rules (line 941 of `eth.ts`) so the relay no longer advertises support it cannot deliver. Return a clear invalid-params style response (for example `-32602`) for any override payload until mirror implements execution support. This is preferable to the current behavior of silently accepting and ignoring overrides.
6. Add or update tests in:
   - `packages/relay/tests/lib/eth/eth_call.spec.ts`
   - `packages/relay/tests/lib/eth/eth_estimateGas.spec.ts`
   - any focused relay contract-service tests needed for request-shape coverage
7. Required relay regression coverage:
   - counterfactual sender simulation succeeds
   - contract-sender simulation succeeds
   - supported override payloads are forwarded exactly once
   - unsupported override payloads are rejected explicitly
   - nonce errors remain `-32000`
   - lazy-create gas floor remains `0xc3500`
8. Run `npm run build` and the targeted relay test suite before handing off for deployment.

## Blockers

- `~/goliath/mirror-node/docs/tasks/2026-04-09-aa-simulation-and-state-override-parity.md` — relay behavior depends on the mirror execution contract for sender parity and overrides

## Acceptance Checklist

- [ ] `eth_call` no longer accepts a `stateOverride` payload that the backend ignores silently
- [ ] Relay forwards supported override payloads exactly as documented
- [ ] Relay documents or implements the correct override contract for `eth_estimateGas`
- [ ] Counterfactual and contract-sender AA simulation cases have relay-level acceptance coverage
- [ ] Unsupported override fields are rejected explicitly at the JSON-RPC layer
- [ ] Nonce error responses remain code `-32000`
- [ ] Lazy-create estimate floor remains `800,000` for fresh-account funding
- [ ] Tests are written and passing
- [ ] Code follows the project's style
