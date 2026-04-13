# Task 002: Publish Relay Image from Main

## Context

- This repo's `CLAUDE.md` requires deployment from the CI-built `main` image, not from a hand-built tag
- The implementation work from Task 001 should land on a feature branch first, then merge to `main`
- Production rollback image digests must be recorded before rollout

## Task

Publish the relay fix through the documented workflow.

Required work:

- Create/use branch `fix/contract-creation-receipt`
- Commit the receipt fix and tests with an intentional message
- Merge the branch into `main` locally
- Push `main` to `origin`
- Wait for `.github/workflows/build-relay.yaml` to finish successfully
- Record:
  - the new `main` image digest
  - the old image digest for FRA/ASH/TYO rollback

Commands to use:

- `git checkout -b fix/contract-creation-receipt`
- `git add <receipt-fix-files>`
- `git commit -m "fix: restrict contractAddress to real creation receipts"`
- `git checkout main && git merge fix/contract-creation-receipt --no-edit && git push origin main`
- `gh run list --repo crypt0grapher/hiero-json-rpc-relay --workflow=build-relay.yaml --limit=1`
- `gh api /users/crypt0grapher/packages/container/hiero-json-rpc-relay%2Fjson-rpc-relay/versions --jq '.[0] | "\(.metadata.container.tags | join(",")) \(.name)"'`

## Blockers

- `task-001-finish-receipt-fix-and-tests.md` — do not publish a build before the targeted tests and build pass

## Acceptance Checklist

- [ ] Feature branch contains the receipt fix commit
- [ ] `main` contains the merged fix
- [ ] CI build for `main` is green
- [ ] New image digest is recorded
- [ ] Old per-region image digests are recorded for rollback
- [ ] Code or config follows the project's style and safety rules

