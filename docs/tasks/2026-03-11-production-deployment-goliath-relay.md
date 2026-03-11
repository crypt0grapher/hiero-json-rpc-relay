# Prepare JSON-RPC Relay for Goliath Production Deployment

**Project:** json-rpc-relay
**Type:** Feature + Infrastructure
**Priority:** P1
**Risk level:** Medium
**Requires deployment?:** Yes
**Requires network freeze?:** No
**Owner:** Goliath Engineering
**Date created:** 2026-03-11
**Related docs / prior issues:** docs/issues/2026-02-10-maxFeePerGas-Tinybar-Unit-Mismatch.md, upstream PR #4902

---

## 1) GOAL / SUCCESS CRITERIA

**What "done" means:**

Two container images published to GHCR:
- `ghcr.io/crypt0grapher/hiero-json-rpc-relay:mainnet` — Goliath Mainnet (chain ID 0x327 = 807 decimal)
- `ghcr.io/crypt0grapher/hiero-json-rpc-relay:testnet` — Goliath Testnet (chain ID 0x22c5 = 8901 decimal, current testnet config)

Both images include upstream v0.75.0 release + our custom patches (fee fixes).
The relay identifies itself as "Goliath Mainnet" / "Goliath Testnet" in RPC responses — no Hedera/Hiero branding.

**Must-have outcomes**

- [ ] `fix/max-fee-per-gas-weibar` merged into `main`
- [ ] Upstream `v0.75.0` merged into `main`, keeping our patches
- [ ] `main` branch has Goliath mainnet defaults (chain ID 0x327)
- [ ] `testnet` branch created from `main` with testnet chain ID (0x22c5)
- [ ] `web3_clientVersion` returns `goliath-relay/<version>` (no "relay/" Hedera prefix)
- [ ] GitHub Actions workflow builds and publishes both images to GHCR
- [ ] Both images are publicly downloadable

**Acceptance criteria (TDD)**

- [ ] `eth_chainId` returns `0x327` on mainnet build
- [ ] `eth_chainId` returns `0x22c5` on testnet build
- [ ] `web3_clientVersion` returns string starting with `goliath-relay/`
- [ ] `net_version` returns `807` on mainnet, `8901` on testnet
- [ ] No references to "Hedera" or "Hiero" in user-facing RPC responses

**Non-goals**

- We are NOT upstreaming Goliath branding changes
- We are NOT changing the HBAR spending plan or rate limiting defaults
- We are NOT merging to upstream/main after v0.75.0

---

## 2) ENVIRONMENT

### Project Details

- **Repository path:** `~/goliath/json-rpc-relay`
- **Language/stack:** TypeScript / Node.js 22 / Lerna monorepo
- **Current version:** 0.75.0-SNAPSHOT (our fork), upstream at 0.76.0-SNAPSHOT on main
- **Build command:** `npm run build`
- **Test command:** `npm run test`
- **Docker build:** `docker build --platform linux/amd64 .`

### Git State

- **Current branch:** `fix/max-fee-per-gas-weibar` (3 commits ahead of `main`)
- **Our main:** at `5062f1a6` (same as upstream v0.75.0-SNAPSHOT minus ~30 commits behind upstream/main)
- **Upstream main:** at `1cfee96b` (~20 commits ahead of v0.75.0 tag, version 0.76.0-SNAPSHOT)
- **Upstream latest tag:** `v0.75.0` at `dd6e6992`
- **Remotes:**
  - `origin` = `git@github.com:crypt0grapher/hiero-json-rpc-relay.git`
  - `upstream` = `git@github.com:hiero-ledger/hiero-json-rpc-relay.git`

### Network Context

- **Mainnet:** Chain ID 0x327 (807 decimal), "Goliath Mainnet"
- **Testnet:** Chain ID 0x22c5 (8901 decimal), "Goliath Testnet"

---

## 3) CONSTRAINTS

### Hard Safety Constraints

- [ ] Preserve all 3 fee-fix commits from `fix/max-fee-per-gas-weibar`
- [ ] Do NOT force-push to origin/main without explicit user approval
- [ ] Do NOT expose secrets in CI workflow or task files

### Code Change Constraints

- [ ] Existing unit tests must still pass after merge
- [ ] Branding changes must be minimal — only user-facing RPC response strings
- [ ] Chain ID is configured via env var `CHAIN_ID` — we change the default, not hardcode

---

## 4) TASK ANALYSIS

### 4.1 Scope of Changes

Three workstreams:

**A. Git merge operations:**
1. Merge `fix/max-fee-per-gas-weibar` → `main`
2. Merge upstream `v0.75.0` tag → `main` (should be clean — our main is based on pre-v0.75.0)
3. Create `testnet` branch from `main`

**B. Goliath branding & chain ID:**
1. Change default `CHAIN_ID` from `0x12a` (Hedera previewnet) to `0x327` (Goliath mainnet)
2. Change `web3_clientVersion` from `relay/<version>` to `goliath-relay/<version>`
3. Update `CHAIN_IDS` constant map to include goliath entries
4. Testnet branch overrides `CHAIN_ID` default to `0x22c5`

**C. CI/CD — GitHub Actions workflow:**
1. Create `.github/workflows/build-relay.yaml` for main branch
2. On testnet branch, adjust trigger to `testnet` branch
3. Pattern identical to `goliath-consensus-node` workflow

### 4.2 Affected Code

| File | Change |
|------|--------|
| `packages/config-service/src/services/globalConfig.ts` | Default `CHAIN_ID` → `0x327` |
| `packages/relay/src/lib/web3.ts` | `clientVersion()` → `goliath-relay/` prefix |
| `packages/relay/src/lib/constants.ts` | Add goliath chain IDs to `CHAIN_IDS` map |
| `.github/workflows/build-relay.yaml` | New CI workflow for Docker image builds |
| Upstream inherited workflows | Disable inherited Hedera/Hiero CI workflows |

### 4.3 Historical Context

**Prior issues:** The `fix/max-fee-per-gas-weibar` branch has 3 commits that fix gas price unit conversions. These are already deployed to testnet and must be preserved in the merge.

**Consensus-node pattern:** `~/goliath/goliath-consensus-node` uses two branches (`main` and `testnet`) with identical CI workflow adjusted for branch triggers and tag patterns. The testnet branch additionally deletes inherited upstream workflows that don't apply to the fork.

---

## 5) SOLUTIONS

### Option A — Merge upstream v0.75.0 tag (stable release)

Merge the stable `v0.75.0` tag rather than upstream/main (which is 0.76.0-SNAPSHOT with potentially unstable changes).

**Pros:** Stable release, matches our fork version string, less merge conflict risk
**Cons:** Doesn't include ~20 post-release commits (some useful fixes)

### Option B — Merge upstream/main (0.76.0-SNAPSHOT)

**Pros:** Latest fixes including new Dockerfile optimization, paymaster features
**Cons:** SNAPSHOT version, potential instability, larger diff, version bump to 0.76.0

### Decision

**Chosen option:** A — Merge v0.75.0 tag. This is a production deployment and we want stability. The new Dockerfile from upstream/main is nice-to-have but not critical; our existing Dockerfile works. We can selectively cherry-pick the Dockerfile optimization later.

---

## 6) STEP-BY-STEP IMPLEMENTATION PLAN

### Phase 1 — Git Merges

```bash
# 1. Merge fix branch into main
git checkout main
git merge fix/max-fee-per-gas-weibar --no-edit

# 2. Merge upstream v0.75.0 tag into main
git merge v0.75.0 --no-edit
# Resolve conflicts if any (likely in package.json version)

# 3. Push main
git push origin main
```

### Phase 2 — Goliath Branding (on main)

**2a. Change default chain ID:**
- File: `packages/config-service/src/services/globalConfig.ts`
- Change `CHAIN_ID` defaultValue from `'0x12a'` to `'0x327'`

**2b. Change client version branding:**
- File: `packages/relay/src/lib/web3.ts`
- Change `'relay/' + ConfigService.get('npm_package_version')` to `'goliath-relay/' + ConfigService.get('npm_package_version')`

**2c. Add Goliath chain IDs to constants:**
- File: `packages/relay/src/lib/constants.ts`
- Add `goliath: 0x327` and `goliath_testnet: 0x22c5` to `CHAIN_IDS`

**2d. Disable inherited upstream workflows:**
- Replace content of each inherited workflow with disabled stub (same pattern as consensus-node)

### Phase 3 — GitHub Actions Workflow

Create `.github/workflows/build-relay.yaml` modeled after the consensus-node workflow but adapted for Node.js/Docker:

```yaml
name: "Build & Publish JSON-RPC Relay Image"
on:
  push:
    branches: [main]
    tags: ["goliath-*"]
  workflow_dispatch:
permissions:
  contents: read
  packages: write
env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}/json-rpc-relay
jobs:
  build-and-publish:
    runs-on: ubuntu-latest
    steps:
      - Checkout
      - Docker metadata (tags: branch, semver, sha)
      - Setup Buildx
      - Login to GHCR
      - Build and push
      - Make package public
```

### Phase 4 — Create Testnet Branch

```bash
git checkout -b testnet main

# Override CHAIN_ID default to 0x22c5
# Adjust workflow triggers to testnet branch
# Adjust tag patterns to goliath-testnet-*

git push origin testnet
```

### Phase 5 — Build & Verify

```bash
# Build both images locally to verify
docker build --platform linux/amd64 -t ghcr.io/crypt0grapher/hiero-json-rpc-relay:mainnet .
docker build --platform linux/amd64 -t ghcr.io/crypt0grapher/hiero-json-rpc-relay:testnet .
```

### Phase 6 — Commit, Push, and Trigger CI

Push both branches to origin. GitHub Actions will build and publish the images.

---

## 7) TASKS

See `.memory-bank/tasks/production-deployment-relay/` for individual task files.
