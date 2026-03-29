# Task 004: Deploy to All 3 Mainnet K3s Clusters

## Context
- 3 K3s clusters: FRA, ASH, TYO
- Kubeconfigs: `~/.kube/goliath-fra.yaml`, `~/.kube/goliath-ash.yaml`, `~/.kube/goliath-tyo.yaml`
- Namespace: `goliath-relay`
- Deployments: `relay-http` (5 replicas), `relay-ws` (1 replica) per cluster
- K8s manifests: `~/goliath/mainnet/k8s/relay/relay-http.yaml`, `relay-ws.yaml`
- **CRITICAL Known Issue:** Do NOT use `kubectl rollout restart` — causes containerd overload. Delete pods one-by-one with 45s sleep between each.

## Task
Deploy the new image to all 3 mainnet K3s clusters. For each cluster:

1. Update the image reference in both `relay-http.yaml` and `relay-ws.yaml` to the new image + digest from task-003
2. Apply the manifests
3. Delete pods one-by-one with 45s sleep between each
4. Verify all pods are Ready before moving to next cluster

**Deployment order:** FRA → ASH → TYO (FRA is primary region)

**Per-cluster procedure (example for FRA):**
```bash
export KUBECONFIG=~/.kube/goliath-fra.yaml

# Apply updated manifests
kubectl apply -f ~/goliath/mainnet/k8s/relay/relay-http.yaml
kubectl apply -f ~/goliath/mainnet/k8s/relay/relay-ws.yaml

# Delete HTTP relay pods one by one
for pod in $(kubectl get pods -n goliath-relay -l app.kubernetes.io/name=relay-http -o name); do
  kubectl delete $pod -n goliath-relay
  echo "Deleted $pod, waiting 45s..."
  sleep 45
done

# Delete WS relay pod
kubectl delete pod -n goliath-relay -l app.kubernetes.io/name=relay-ws

# Wait for all pods ready
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/part-of=goliath-relay -n goliath-relay --timeout=300s

# Verify
kubectl get pods -n goliath-relay -o wide
```

Repeat for ASH and TYO.

**Also update manifest files** in `~/goliath/mainnet/k8s/relay/`:
- `relay-http.yaml` line ~101: update image + digest
- `relay-ws.yaml` line ~93: update image + digest

## Blockers
- `task-003-build-and-push-image.md` — need the new image digest before deploying

## Acceptance Checklist
- [ ] FRA: relay-http (5/5 pods) and relay-ws (1/1 pod) running new image
- [ ] ASH: relay-http (5/5 pods) and relay-ws (1/1 pod) running new image
- [ ] TYO: relay-http (5/5 pods) and relay-ws (1/1 pod) running new image
- [ ] All pods show Ready status
- [ ] No CrashLoopBackOff or Error states
- [ ] Manifest files updated with new image digest
