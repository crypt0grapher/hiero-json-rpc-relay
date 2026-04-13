# Subtask 002: Verify Redis TX Pool is Fully Functional (Solo Parity)

**Status:** COMPLETED (2026-03-30, conditional pass — 2 issues documented)
**Priority:** P1 (parallel with subtask-001)
**Blocked by:** Nothing
**Blocks:** Nothing (informational verification)
**Estimated time:** 1-2 hours
**Branch:** None (operational verification, no code changes)

---

## Context

Solo testnet works correctly because Redis tx-pool is ENABLED. Mainnet enabled Redis on
2026-03-26 along with the nonce floor fix. This subtask verifies that the current state
matches solo's proven configuration and that pending nonce tracking works correctly.

Redis tx-pool is the safety net that handles the window between tx submission and mirror
ingestion. When a user sends 3 txs rapidly, the tx-pool tracks all 3 as pending, so
`eth_getTransactionCount("pending")` returns `latest + 3` even before the mirror has
ingested any of them.

---

## Verification Steps

### Part 1: ConfigMap Audit (All 3 Clusters)

For each cluster (FRA, ASH, TYO), verify the relay ConfigMap contains:

```bash
# FRA
KUBECONFIG=~/.kube/goliath-fra.yaml
kubectl get configmap -n goliath-relay relay-http-config -o yaml | grep -E 'REDIS_ENABLED|ENABLE_TX_POOL|TXPOOL_API_ENABLED|REDIS_URL'

# ASH
KUBECONFIG=~/.kube/goliath-ash.yaml
kubectl get configmap -n goliath-relay relay-http-config -o yaml | grep -E 'REDIS_ENABLED|ENABLE_TX_POOL|TXPOOL_API_ENABLED|REDIS_URL'

# TYO
KUBECONFIG=~/.kube/goliath-tyo.yaml
kubectl get configmap -n goliath-relay relay-http-config -o yaml | grep -E 'REDIS_ENABLED|ENABLE_TX_POOL|TXPOOL_API_ENABLED|REDIS_URL'
```

**Expected values on ALL pods (relay-http, relay-ws, relay-internal-http, relay-internal-ws):**

| Key | Expected Value | Why |
|-----|---------------|-----|
| `REDIS_ENABLED` | `true` | Enables Redis as cache backend |
| `ENABLE_TX_POOL` | `true` | Enables pending transaction tracking |
| `TXPOOL_API_ENABLED` | `true` | Enables txpool_content / txpool_status RPC methods |
| `REDIS_URL` | `redis://redis.goliath-relay.svc.cluster.local:6379` (or equivalent) | Connection to cluster-local Redis |

Also verify ALL relay deployment types carry these values (not just relay-http):
```bash
for deployment in relay-http relay-ws relay-internal-http relay-internal-ws; do
  echo "--- $deployment ---"
  kubectl get configmap -n goliath-relay ${deployment}-config -o yaml 2>/dev/null | grep -E 'REDIS_ENABLED|ENABLE_TX_POOL'
done
```

### Part 2: Redis Pod Health

```bash
# FRA
KUBECONFIG=~/.kube/goliath-fra.yaml
kubectl get pods -n goliath-relay -l app=redis
kubectl exec -n goliath-relay deploy/redis -- redis-cli ping
kubectl exec -n goliath-relay deploy/redis -- redis-cli info memory | head -5

# Repeat for ASH, TYO
```

**Expected:**
- Redis pod Running, Ready 1/1
- `redis-cli ping` returns `PONG`
- Memory usage reasonable (< 100MB for tx-pool)

### Part 3: Relay Log Verification

Check relay logs for Redis connection errors:

```bash
KUBECONFIG=~/.kube/goliath-fra.yaml
# Check last 100 lines of one relay-http pod for Redis errors
kubectl logs -n goliath-relay deploy/relay-http --tail=100 | grep -i 'redis\|ECONNREFUSED\|tx.pool\|pending'
```

**Expected:** No Redis connection errors. Occasional tx-pool log lines are normal.

### Part 4: Pending Nonce Functional Test

This is the critical test -- verifying that `pending` returns a higher nonce than
`latest` during the in-flight window.

```bash
# 1. Get current nonce for dev account (0.0.1010, 0xaa91057c8f98af30c44bb8708399bf4daa188a81)
DEV_ADDR="0xaa91057c8f98af30c44bb8708399bf4daa188a81"

curl -sS https://rpc.goliath.net \
  -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionCount\",\"params\":[\"$DEV_ADDR\",\"latest\"]}" | jq .result

# 2. Send a tx via cast (from dev account)
# NOTE: This requires the dev private key -- execute from fra-bk1 where keys are available

# 3. IMMEDIATELY query pending (within 1 second, before mirror ingests)
curl -sS https://rpc.goliath.net \
  -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionCount\",\"params\":[\"$DEV_ADDR\",\"pending\"]}" | jq .result

# 4. Expected: pending = latest + 1
```

**Alternative without sending a real tx:** Use the txpool API if enabled:
```bash
curl -sS https://rpc.goliath.net \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"txpool_status","params":[]}'
```

### Part 5: Compare with Solo Configuration

Reference solo's relay config for parity check:

```bash
# Solo relay config (from ~/goliath/solo)
cat ~/goliath/solo/k8s/relay/relay-http-config.yaml | grep -E 'REDIS_ENABLED|ENABLE_TX_POOL|TXPOOL_API_ENABLED'
```

Document any differences between solo and mainnet relay configuration.

---

## Known Caveats

1. **Redis does NOT persist across pod restarts.** The tx-pool is ephemeral. If a relay
   pod restarts, its pending transactions are lost. This is acceptable -- the window is
   short (seconds) and mirror ingestion provides the durable state.

2. **Redis is per-cluster, not global.** FRA relay pods use FRA Redis, ASH uses ASH
   Redis, etc. A user hitting FRA relay has pending state only on FRA. If the next
   request routes to ASH (unlikely with FRA-only Cloudflare), pending state is lost.

3. **`USE_ASYNC_TX_PROCESSING=false` is required.** Async tx processing bypasses the
   tx-pool pending tracking. All mainnet relay pods MUST have this set to false.
   ```bash
   kubectl get configmap -n goliath-relay relay-http-config -o yaml | grep USE_ASYNC_TX_PROCESSING
   ```

---

## Acceptance Checklist

- [ ] `REDIS_ENABLED=true` on ALL relay ConfigMaps in ALL 3 clusters
- [ ] `ENABLE_TX_POOL=true` on ALL relay ConfigMaps in ALL 3 clusters
- [ ] `TXPOOL_API_ENABLED=true` on ALL relay ConfigMaps in ALL 3 clusters
- [ ] `USE_ASYNC_TX_PROCESSING=false` on ALL relay ConfigMaps in ALL 3 clusters
- [ ] Redis pod Running and responding to PING on ALL 3 clusters
- [ ] No Redis connection errors in relay logs
- [ ] `pending` nonce correctly returns `latest + N` for in-flight transactions (or documented reason why test was not possible)
- [ ] Solo config comparison documented -- any differences explained
