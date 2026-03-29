# Task 005: Verify Deployment and Rate Limits

## Context
- After deploying new image to all 3 clusters, verify:
  - Rate limits are 10x (2500 XCN total budget)
  - Nonce floor fix is active
  - Relay is healthy and serving requests
- Rate limit budget resets on pod restart (HbarLimitService reinitializes)

## Task
Verify the deployment across all 3 clusters.

**1. Check relay logs for rate limit configuration:**
```bash
for region in fra ash tyo; do
  echo "=== $region ==="
  export KUBECONFIG=~/.kube/goliath-${region}.yaml
  kubectl logs deploy/relay-http -n goliath-relay --tail=50 | grep "XCN Limiter"
done
```

Expected log line:
```
XCN Limiter successfully configured: totalBudget=2500 ℏ, maxLimitForBasicTier=30 ℏ, maxLimitForExtendedTier=10 ℏ, maxLimitForprivilegedTier=27 ℏ, ...
```

**2. Test RPC endpoint:**
```bash
# Test against mainnet RPC
curl -s -X POST https://mainnet.rpc.goliath.net -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}' | jq .
```

**3. Verify nonce floor logging (on next tx):**
```bash
kubectl logs deploy/relay-http -n goliath-relay --tail=100 | grep "NONCE-FLOOR"
```

**4. Check no rate limit errors in recent logs:**
```bash
for region in fra ash tyo; do
  echo "=== $region ==="
  export KUBECONFIG=~/.kube/goliath-${region}.yaml
  kubectl logs deploy/relay-http -n goliath-relay --since=5m | grep -c "Rate limit exceeded" || echo "0 rate limit errors"
done
```

## Blockers
- `task-004-deploy-to-mainnet-clusters.md` — all clusters must be deployed first

## Acceptance Checklist
- [ ] Relay logs show `totalBudget=2500` on all 3 clusters
- [ ] `eth_blockNumber` returns valid response
- [ ] No "XCN Rate limit exceeded" errors in recent logs
- [ ] Pods stable (no restarts) after 5 minutes
