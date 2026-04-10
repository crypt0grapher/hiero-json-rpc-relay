# Relay: Compatibility Mode for Unsupported `stateOverride`

## Context

- On 2026-04-09 the relay was intentionally tightened to reject unsupported `stateOverride` payloads with `-32602` instead of silently accepting and dropping them.
- That behavior now lives in:
  - `packages/relay/src/lib/eth.ts`
    - `estimateGas()` resolves param 2 and calls `rejectUnsupportedStateOverride()`
    - `call()` resolves param 2 and calls `rejectUnsupportedStateOverride()`
  - `packages/relay/tests/lib/eth/eth_call.spec.ts`
  - `packages/relay/tests/lib/eth/eth_estimateGas.spec.ts`
- The mainnet sender-parity fixes are already deployed, so some client flows can now succeed even if `stateOverride` is ignored.
- The new request is to stop hard-failing these requests and instead accept a well-formed override object but ignore it when the backend does not support execution-layer overrides.
- Mainnet orchestration task: `~/goliath/mainnet/docs/tasks/2026-04-10-stateoverride-compatibility-ignore-unsupported.md`
- Prior relay task that chose explicit rejection: `~/goliath/json-rpc-relay/docs/tasks/2026-04-09-thirdweb-aa-relay-state-override-plumbing.md`

## Task

Change the relay contract for unsupported `stateOverride` from strict rejection to a documented compatibility mode.

Execute in this order:

1. Create `fix/stateoverride-compatibility-ignore-unsupported` from the latest production line.
2. Add a relay config surface for unsupported overrides, for example:
   - `STATE_OVERRIDE_UNSUPPORTED_BEHAVIOR=ignore|reject`
3. Update `packages/relay/src/lib/eth.ts` so:
   - in `ignore` mode, a well-formed `stateOverride` object is accepted and dropped before the mirror call,
   - in `reject` mode, the current `INVALID_PARAMETER(2, 'stateOverride is not supported')` remains available.
4. Keep malformed param 2 values invalid.
   - If the request sends a non-object as param 2, validation should still fail with `-32602`.
5. Add observability:
   - structured log line with request ID and method name when an override is ignored,
   - dedicated metric/counter for ignored overrides by method.
6. Update tests in:
   - `packages/relay/tests/lib/eth/eth_call.spec.ts`
   - `packages/relay/tests/lib/eth/eth_estimateGas.spec.ts`
7. Required regression coverage:
   - ignore mode returns the same result/estimate as the no-override path,
   - reject mode preserves the current behavior,
   - malformed param 2 still fails validation,
   - sender-parity paths still succeed,
   - nonce errors remain `-32000`,
   - lazy-create estimate floor remains `0xc3500`.
8. Run:
   - `npm run build`
   - `npx ts-mocha packages/relay/tests/lib/eth/eth_call.spec.ts packages/relay/tests/lib/eth/eth_estimateGas.spec.ts --exit`
9. Update any relay-side docs/comments that still promise explicit rejection only.

## Contract Decision (2026-04-10)

- `STATE_OVERRIDE_UNSUPPORTED_BEHAVIOR=reject|ignore`
- Default behavior remains `reject`
- Goliath mainnet deployment target is `ignore`
- A "well-formed" `stateOverride` in this task means only: non-null object, not array
- In `ignore` mode:
  - `eth_call` and `eth_estimateGas` must accept the object and behave exactly like the no-override path
  - the override object must be dropped before any mirror-web3 call
  - the relay must emit a structured log with `method`, `requestId`, `behavior=ignore`, `overrideAddressCount`, and the override field kinds present
  - the relay must increment `rpc_relay_unsupported_state_override_total{method,behavior="ignore"}`
- In `reject` mode:
  - keep `INVALID_PARAMETER(2, 'stateOverride is not supported')`
- Non-object param 2 values still fail validation with `-32602`
- Direct mirror `/api/v1/contracts/call` behavior is intentionally unchanged by this relay task

## Blockers

- `~/goliath/mainnet/docs/tasks/2026-04-10-stateoverride-compatibility-ignore-unsupported.md` — top-level contract decision and rollout order

## Acceptance Checklist

- [ ] Relay supports a mode-controlled contract for unsupported `stateOverride`
- [ ] Ignore mode accepts well-formed override objects for `eth_call`
- [ ] Ignore mode accepts well-formed override objects for `eth_estimateGas`
- [ ] Reject mode preserves the April 9 explicit `-32602` behavior
- [ ] Ignored overrides are logged and counted
- [ ] Unsupported overrides are not forwarded to mirror-web3
- [ ] Non-object param 2 values still fail validation
- [ ] Sender-parity behavior remains intact
- [ ] Nonce error responses remain `-32000`
- [ ] Lazy-create estimate floor remains `800000`
- [ ] Tests are written and passing
- [ ] Code follows the project's style
