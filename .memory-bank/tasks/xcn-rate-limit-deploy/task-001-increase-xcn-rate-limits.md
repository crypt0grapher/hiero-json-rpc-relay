# Task 001: Increase XCN Rate Limits 10x

## Context
- XCN rate limit defaults are from upstream Hedera (250 XCN total, 3 XCN per basic user) — too restrictive for Goliath Mainnet
- Rate limits are defined as code defaults in `packages/config-service/src/services/globalConfig.ts`
- No ConfigMap overrides exist in the deployed relay — code defaults are in effect
- Comments in `.env.http.example` and Helm chart should be updated to match

## Task
Increase all 4 XCN rate limit default values by 10x in `globalConfig.ts`. Update corresponding comments in `.env.http.example` and `charts/hedera-json-rpc-relay/values.yaml`.

**Changes in `packages/config-service/src/services/globalConfig.ts`:**

| Config Key | Line | Old Value | New Value |
|------------|------|-----------|-----------|
| `HBAR_RATE_LIMIT_BASIC` | ~316 | `300_000_000` (3 XCN) | `3_000_000_000` (30 XCN) |
| `HBAR_RATE_LIMIT_EXTENDED` | ~321 | `100_000_000` (1 XCN) | `1_000_000_000` (10 XCN) |
| `HBAR_RATE_LIMIT_PRIVILEGED` | ~326 | `270_000_000` (2.7 XCN) | `2_700_000_000` (27 XCN) |
| `HBAR_RATE_LIMIT_TINYBAR` | ~336 | `25_000_000_000` (250 XCN) | `250_000_000_000` (2500 XCN) |

**Changes in `.env.http.example` (comments only):**
- Line 72: `# HBAR_RATE_LIMIT_TINYBAR=250000000000 # Total XCN budget (2500 XCN)`
- Line 73: keep duration unchanged
- Line 74: `# HBAR_RATE_LIMIT_BASIC=3000000000 # Individual limit for BASIC tier (30 XCN)`
- Line 75: `# HBAR_RATE_LIMIT_EXTENDED=1000000000 # Individual limit for EXTENDED tier (10 XCN)`
- Line 76: `# HBAR_RATE_LIMIT_PRIVILEGED=2700000000 # Individual limit for PRIVILEGED tier (27 XCN)`

## Blockers
No blockers.

## Acceptance Checklist
- [ ] `HBAR_RATE_LIMIT_BASIC` default is `3_000_000_000` (30 XCN)
- [ ] `HBAR_RATE_LIMIT_EXTENDED` default is `1_000_000_000` (10 XCN)
- [ ] `HBAR_RATE_LIMIT_PRIVILEGED` default is `2_700_000_000` (27 XCN)
- [ ] `HBAR_RATE_LIMIT_TINYBAR` default is `250_000_000_000` (2500 XCN)
- [ ] `.env.http.example` comments updated to match
- [ ] `npm run build` succeeds
- [ ] Code follows the project's style (SPDX header, prettier)
