# Task 003: Build and Push Docker Image

## Context
- After merge to main, need to build a new Docker image for mainnet deployment
- Image must be linux/amd64 (servers are x86, local machine is ARM Mac)
- Push to GHCR: `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay`
- Tag convention: descriptive tag + sha digest for pinning
- GHCR login requires `$GITHUB_TOKEN` env var

## Task
Build and push a new relay Docker image from `main` branch.

**Commands:**
```bash
cd ~/goliath/json-rpc-relay
git checkout main

# Build image
docker build --platform linux/amd64 -t ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:xcn-limit-10x .

# Login and push
echo $GITHUB_TOKEN | docker login ghcr.io -u crypt0grapher --password-stdin
docker push ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:xcn-limit-10x
```

After push, capture the digest:
```bash
docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:xcn-limit-10x
```

## Blockers
- `task-002-commit-and-merge-to-main.md` — main must contain all changes before building

## Acceptance Checklist
- [ ] Image built successfully for `linux/amd64`
- [ ] Image pushed to GHCR
- [ ] Image digest captured for pinning in K8s manifests
- [ ] Image tag: `xcn-limit-10x`
