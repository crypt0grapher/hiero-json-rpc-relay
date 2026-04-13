# Task 003: Deploy Relay and Verify Receipts

## Context

- Production relay runs in FRA, ASH, and TYO under namespace `goliath-relay`
- This bug affects explorer indexing, so canary verification must include actual receipt semantics, not just pod health
- Autoscout reindex is not a reliable remediation path for already-bad addresses

## Task

Deploy the CI-built relay image and prove the receipt semantics are fixed before any new MasterChef deployment is treated as canonical.

Required work:

- FRA canary `relay-http` first
- Verify:
  - non-creation receipt returns `contractAddress: null`
  - creation receipt returns `to: null`
  - no pod crash loops or obvious 5xx regression
- Roll out `relay-http` and `relay-ws` to FRA/ASH/TYO only after canary passes
- Keep exact rollback commands ready using the recorded old image digests

Suggested commands:

- `KUBECONFIG=~/.kube/goliath-fra.yaml kubectl set image deploy/relay-http -n goliath-relay relay-http=<new-image>`
- `KUBECONFIG=~/.kube/goliath-fra.yaml kubectl rollout pause deploy/relay-http -n goliath-relay`
- Per-region digest check:
  - `KUBECONFIG=~/.kube/goliath-<region>.yaml kubectl get deploy -n goliath-relay relay-http -o jsonpath='{.spec.template.spec.containers[0].image}'`

## Blockers

- `task-002-publish-relay-image-from-main.md` — need the CI-built digest before rollout

## Acceptance Checklist

- [ ] FRA canary uses the new image and stays healthy
- [ ] Receipt spot checks confirm fixed semantics
- [ ] Full FRA/ASH/TYO rollout completes successfully
- [ ] Rollback commands are written and tested mentally before rollout
- [ ] Post-rollout soak shows no obvious relay regression
- [ ] Code or config follows the project's style and safety rules

