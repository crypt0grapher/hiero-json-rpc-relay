# Increase XCN Rate Limits 10x + Deploy Nonce Floor Fix to Mainnet

**Project:** json-rpc-relay
**Type:** Infrastructure + Code Fix
**Priority:** P1
**Risk level:** Low
**Requires deployment?:** Yes (all 3 mainnet K3s clusters)
**Requires network freeze?:** No
**Owner:** Goliath Engineering
**Date created:** 2026-03-27
**Related docs / prior issues:** docs/issues/2026-02-10-maxFeePerGas-Tinybar-Unit-Mismatch.md

---

## 1) GOAL / SUCCESS CRITERIA

**What "done" means:**

XCN rate limits increased 10x in code defaults, nonce floor fix deployed, new relay image running on all 3 mainnet K3s clusters (FRA, ASH, TYO). Rate limit budget resets on deploy (pod restart reinitializes HbarLimitService).

**Must-have outcomes**

- [ ] XCN rate limits increased 10x in `globalConfig.ts`
- [ ] Nonce floor fix (2 commits + 1 uncommitted logging change) merged into `main`
- [ ] New Docker image built, pushed to GHCR
- [ ] Image deployed to FRA, ASH, TYO clusters (relay-http + relay-ws)
- [ ] Rate limits verified via relay logs post-deploy
- [ ] Runbook updated with new rate limit values

**Non-goals**

- Not changing `HBAR_RATE_LIMIT_DURATION` (stays 24h)
- Not adding ConfigMap env var overrides (code defaults sufficient for now)
- Not deploying to testnet (mainnet only)

---

## 2) ENVIRONMENT

### Project Details

- **Repository path:** `~/goliath/json-rpc-relay`
- **Language/stack:** TypeScript / Node.js 22 / Lerna monorepo
- **Current branch:** `fix/nonce-floor-stale-mirror-ethereum-nonce` (2 commits + 1 uncommitted change ahead of `main`)
- **Build command:** `npm run build`
- **Docker build:** `docker build --platform linux/amd64 .`

### Deployment Details

- **Namespace:** `goliath-relay`
- **Deployments:** `relay-http` (5 replicas), `relay-ws` (1 replica) per cluster
- **Current image:** `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:nonce-floor-fix-v2@sha256:fdc235c9...`
- **K3s clusters:** FRA (`~/.kube/goliath-fra.yaml`), ASH (`~/.kube/goliath-ash.yaml`), TYO (`~/.kube/goliath-tyo.yaml`)
- **Manifests:** `~/goliath/mainnet/k8s/relay/relay-http.yaml`, `relay-ws.yaml`

### Network Context

- **Chain ID:** 0x0147 = 327 (Goliath Mainnet)
- **3 K3s clusters:** FRA (fra-sv1), ASH (ash-sv1), TYO (tyo-sv1)
- **SSH:** `ssh -i ~/.ssh/id_ed25519_latitude ubuntu@<ip>`

---

## 3) CONSTRAINTS

### Safety Constraints

- [ ] Delete relay pods one-by-one with 45s sleep (NOT rollout restart — Known Issue: containerd overload)
- [ ] Do NOT flush iptables
- [ ] Do NOT expose operator keys or secrets

---

## 4) TASK ANALYSIS

### 4.1 Symptoms

- "XCN Rate limit exceeded" errors (code `-32606`) hitting users
- Rate limit budget (250 XCN total, 3 XCN per BASIC user) exhausting within 24h window
- Nonce stale mirror issue causing failed transactions

### 4.2 Impact

- **User impact:** All EVM transactions blocked when rate limit is hit
- **System impact:** Relay returns -32606 errors until daily reset

### 4.3 Affected Code

| File | Change | Description |
|------|--------|-------------|
| `packages/config-service/src/services/globalConfig.ts` | Lines 316-337 | Increase 4 rate limit defaults 10x |
| `.env.http.example` | Lines 72-76 | Update comments to match new defaults |
| `charts/hedera-json-rpc-relay/values.yaml` | Line 72-78 | Update comments |
| `packages/relay/src/lib/services/ethService/accountService/AccountService.ts` | Lines 431-439 | Nonce floor logging (uncommitted) |

### 4.4 Rate Limit Values (Current → New)

| Setting | Current | New (10x) | Units |
|---------|---------|-----------|-------|
| `HBAR_RATE_LIMIT_BASIC` | 300,000,000 (3 XCN) | 3,000,000,000 (30 XCN) | tinybars |
| `HBAR_RATE_LIMIT_EXTENDED` | 100,000,000 (1 XCN) | 1,000,000,000 (10 XCN) | tinybars |
| `HBAR_RATE_LIMIT_PRIVILEGED` | 270,000,000 (2.7 XCN) | 2,700,000,000 (27 XCN) | tinybars |
| `HBAR_RATE_LIMIT_TINYBAR` | 25,000,000,000 (250 XCN) | 250,000,000,000 (2500 XCN) | tinybars |
| `HBAR_RATE_LIMIT_DURATION` | 86,400,000 (24h) | **unchanged** | ms |

### 4.5 Tasks

- `.memory-bank/tasks/xcn-rate-limit-deploy/task-001-increase-xcn-rate-limits.md`
- `.memory-bank/tasks/xcn-rate-limit-deploy/task-002-commit-and-merge-to-main.md`
- `.memory-bank/tasks/xcn-rate-limit-deploy/task-003-build-and-push-image.md`
- `.memory-bank/tasks/xcn-rate-limit-deploy/task-004-deploy-to-mainnet-clusters.md`
- `.memory-bank/tasks/xcn-rate-limit-deploy/task-005-verify-deployment.md`

### 4.6 Historical Context

**Prior issues searched:** `docs/issues/`, `docs/tasks/`
- `docs/tasks/2026-03-11-production-deployment-goliath-relay.md` — prior deployment task. Provides image build and deploy patterns.
- Known Issue: "Relay `rollout restart` → containerd overload" → must delete pods one-by-one with 45s sleep.
- Known Issue: "Relay SDK state exhaustion" → staggered pod restart pattern.

**Regression from recent changes?** No — rate limits are original upstream defaults, never tuned for Goliath.

---

## 5) ROOT CAUSE ANALYSIS

### 5.1 Root Cause

Upstream Hedera defaults (250 XCN total budget, 3 XCN per basic user, 24h reset) are too restrictive for Goliath Mainnet traffic patterns. These defaults were designed for Hedera's public Hashio service, not a private chain operator.

### 5.2 Contributing Factors

- Goliath Mainnet has higher per-user transaction volume than Hedera public endpoints
- No ConfigMap overrides were set during initial deployment
- Rate limit budget was consumed before daily reset

---

## 6) SOLUTION

**Chosen approach:** Change code defaults in `globalConfig.ts` (10x increase), build new image that also includes the nonce floor fix, deploy to all 3 mainnet clusters.

**Why code defaults (not ConfigMap env vars):** We're already building a new image for the nonce fix. Baking limits into code keeps ConfigMaps clean and ensures any future deploy automatically gets correct limits. Env var overrides remain available if per-cluster tuning is ever needed.

**Reset behavior:** Pod restart reinitializes `HbarLimitService`, which resets all spending plans to zero. No explicit reset action needed — deploy IS the reset.

---

## 7) STEP-BY-STEP IMPLEMENTATION PLAN

### Step 1 — Increase XCN rate limits in globalConfig.ts

Change 4 default values in `packages/config-service/src/services/globalConfig.ts`:
- `HBAR_RATE_LIMIT_BASIC`: 300_000_000 → 3_000_000_000
- `HBAR_RATE_LIMIT_EXTENDED`: 100_000_000 → 1_000_000_000
- `HBAR_RATE_LIMIT_PRIVILEGED`: 270_000_000 → 2_700_000_000
- `HBAR_RATE_LIMIT_TINYBAR`: 25_000_000_000 → 250_000_000_000

Update comments in `.env.http.example` and `charts/.../values.yaml`.

### Step 2 — Commit all changes and merge to main

1. Commit uncommitted AccountService.ts logging change
2. Commit rate limit increase
3. Checkout main, merge `fix/nonce-floor-stale-mirror-ethereum-nonce`
4. Push main to origin

### Step 3 — Build and push Docker image

```bash
cd ~/goliath/json-rpc-relay
docker build --platform linux/amd64 -t ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:xcn-limit-10x .
echo $GITHUB_TOKEN | docker login ghcr.io -u crypt0grapher --password-stdin
docker push ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:xcn-limit-10x
```

### Step 4 — Deploy to all 3 mainnet clusters

For each cluster (FRA, ASH, TYO):
1. Get new image digest from GHCR
2. Update `relay-http.yaml` and `relay-ws.yaml` image reference
3. Apply ConfigMap + Deployment: `kubectl apply -f`
4. Delete pods one-by-one with 45s sleep (NOT rollout restart)
5. Verify all pods healthy before moving to next cluster

### Step 5 — Verify

- Check relay logs for `XCN Limiter successfully configured: totalBudget=2500 XCN`
- Verify `eth_sendRawTransaction` works (no rate limit errors)
- Check pod readiness across all 3 clusters

---

## 8) VERIFICATION CHECKLIST

- [ ] All relay pods healthy on FRA
- [ ] All relay pods healthy on ASH
- [ ] All relay pods healthy on TYO
- [ ] Relay logs show new rate limits (2500 XCN total budget)
- [ ] `eth_sendRawTransaction` succeeds without rate limit error
- [ ] No increase in error rate post-deploy

---

## 9) ROLLBACK

**Trigger:** Pod crashloops, rate limit errors persist, relay unhealthy

**Procedure:**
1. Revert image to previous: `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:nonce-floor-fix-v2@sha256:fdc235c9ecd7d5edf70b8305da69284b4586141bcb7400add0a61cbd27175da1`
2. `kubectl set image deployment/relay-http relay=<previous-image> -n goliath-relay`
3. Delete pods one-by-one with 45s sleep
