# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hedera JSON-RPC Relay — an Ethereum JSON-RPC API implementation for Hedera Hashgraph. It bridges Ethereum-compatible clients with Hedera's Consensus Nodes (via Hedera SDK/gRPC) and Mirror Nodes (via REST API). This is a TypeScript monorepo managed with Lerna and npm workspaces.

## Build & Development Commands

```bash
npm install              # Install all dependencies and link workspaces
npm run build            # Build all packages (lerna run build)
npm run lint             # Lint all packages
npm run format           # Format all packages with prettier
npm run test             # Run unit tests across all packages
npm run start            # Start HTTP JSON-RPC server (port 7546)
npm run start:ws         # Start WebSocket server (port 8546)
```

### Running Tests for a Single Package

```bash
# Relay core library unit tests
cd packages/relay && npx ts-mocha --recursive './tests/**/*.spec.ts' --exit

# Server integration tests
cd packages/server && npx ts-mocha --recursive './tests/integration/*.spec.ts' './tests/integration/**/*.spec.ts' --exit

# WS server unit tests
cd packages/ws-server && npx ts-mocha --recursive './tests/unit/**/*.spec.ts' --exit

# Config service tests
cd packages/config-service && npx ts-mocha --recursive './tests/**/*.spec.ts' --exit
```

### Running a Single Test by Grep Pattern

```bash
# From relay package — run tests matching a tag (e.g. @ethGetBalance)
cd packages/relay && npx ts-mocha --recursive './tests/**/*.spec.ts' './tests/**/**/*.spec.ts' -g '@ethGetBalance' --exit

# Named scripts also exist for common ones:
cd packages/relay && npm run test:eth-call
cd packages/relay && npm run test:eth-send-raw-transaction
# See packages/relay/package.json "scripts" for full list
```

### Acceptance Tests (E2E, requires running relay + Hedera network)

```bash
npm run acceptancetest                    # All acceptance tests
npm run acceptancetest:api_batch1         # Specific batch
npm run acceptancetest:release            # Release-critical tests
npm run acceptancetest:ws                 # WebSocket acceptance tests
```

## Monorepo Package Structure

```
packages/
├── config-service   # @hashgraph/json-rpc-config-service — Singleton env var management
├── relay            # @hashgraph/json-rpc-relay — Core library (ETH method implementations)
├── server           # @hashgraph/json-rpc-server — Koa HTTP server exposing JSON-RPC endpoint
└── ws-server        # @hashgraph/json-rpc-ws-server — WebSocket server for eth_subscribe
```

**Dependency chain**: `config-service` ← `relay` ← `server` ← `ws-server`

Each package builds to `dist/` via TypeScript compilation. The build must complete in dependency order (handled by `lerna run build`).

## Architecture

### Dual Client Strategy
- **Mirror Node Client** (`relay/src/lib/clients/mirrorNodeClient.ts`): Axios HTTP client for read-heavy historical queries (blocks, transactions, logs, accounts). Includes retry logic, DNS caching, connection pooling.
- **SDK Client** (`relay/src/lib/clients/sdkClient.ts`): Hedera SDK (gRPC) for transaction submission to consensus nodes. Wraps `EthereumTransaction`, handles file operations for large contracts.

### Service-Oriented ETH Implementation
`EthImpl` (`relay/src/lib/eth.ts`) delegates to specialized services under `relay/src/lib/services/ethService/`:
- `accountService/` — eth_getBalance, eth_getTransactionCount
- `blockService/` — eth_getBlockByHash, eth_getBlockByNumber, eth_blockNumber
- `transactionService/` — eth_sendRawTransaction, eth_getTransactionByHash, eth_getTransactionReceipt
- `contractService/` — eth_call, eth_estimateGas, eth_getCode, eth_getStorageAt
- `feeService/` — eth_gasPrice, eth_feeHistory
- `ethFilterService/` — eth_newFilter, eth_getLogs, eth_getFilterChanges

Methods are registered via `@rpcMethod()` decorator and dispatched through `relay/src/lib/dispatcher/rpcMethodDispatcher.ts`.

### Two-Tier Caching
- **Local LRU** (`lru-cache`): In-memory, single-process. Used when Redis is disabled.
- **Redis** (`redis` v5): Distributed cache for multi-instance deployments. Enabled via `REDIS_ENABLED=true`.
- Factory in `relay/src/lib/factories/cacheClientFactory.ts` selects strategy at runtime.
- Method-level caching via `@cache()` decorator.

### Rate Limiting
- **IP-based**: 3 tiers by method expense (Tier 1: 100/min for eth_call; Tier 3: 1600/min for eth_chainId). Storage: LRU or Redis.
- **HBAR-based**: Tracks operator HBAR spending per IP/address with spending plans (BASIC/EXTENDED/PRIVILEGED tiers). Prevents excessive operator costs.

### Configuration
All env vars are defined in `packages/config-service/src/services/globalConfig.ts` — this is the single source of truth. Reference `.env.http.example` for examples. Config is accessed via `ConfigService.get(ConfigKey.SOME_KEY)`.

## Code Style & Conventions

### File Headers
Every `.ts` file must start with this comment (enforced by ESLint custom rule):
```ts
// SPDX-License-Identifier: Apache-2.0
```

### Formatting
- Prettier: `singleQuote: true`, `semi: true`, `printWidth: 120`
- ESLint: flat config in `eslint.config.mjs`, import sorting via `simple-import-sort`
- Pre-commit hook (husky + lint-staged) auto-runs eslint + prettier on staged `.ts` files

### Logging
Use pino logger (never `console.log`). Request context propagates via `AsyncLocalStorage` — all logs automatically include `requestId`.

### Error Handling
Use `JsonRpcError` class from `relay/src/lib/errors/JsonRpcError.ts`. Non-critical failures (cache, rate limits) use fail-open strategy — they log warnings but don't block requests.

## Testing Patterns

- **Framework**: Mocha + Chai + Sinon, coverage via c8, TypeScript via ts-mocha
- **Test naming**: `describe('ClassName') > describe('methodName') > it('should ...')`
- **Mocking**: Sinon stubs/spies for external dependencies; `axios-mock-adapter` for HTTP; `redis-memory-server` for Redis
- **Assertions**: Use `chai-as-promised` (`expect(...).to.be.rejectedWith()`) — don't use try/catch
- **Test helpers** (`packages/relay/tests/helpers.ts`):
  - `overrideEnvsInMochaDescribe(envs)` — override env vars for a describe block
  - `withOverriddenEnvsInMochaTest(envs, tests)` — override env vars for specific tests
  - `useInMemoryRedisServer(logger, port)` — spin up in-memory Redis for a test suite
- **State cleanup**: Always restore sinon stubs in `afterEach` (typically via `sinon.restore()`)

## Fork Status

This repository is a fork of `hiero-ledger/hiero-json-rpc-relay` maintained under the `crypt0grapher` GitHub namespace. Remotes:

- `origin` = `git@github.com:crypt0grapher/hiero-json-rpc-relay.git` (fork — push here)
- `upstream` = `git@github.com:hiero-ledger/hiero-json-rpc-relay.git` (original — PR target)

### Active Patches (merged to main, not yet in upstream)

All Goliath patches are merged into `main`. The CI-built image from `main` is the production image.

| Commit | Description |
|--------|-------------|
| `89fd1a85` | Set baseFeePerGas to gas price for Blockscout compatibility |
| `d1b6f1d2` | Add nonce floor from contract results to prevent stale mirror nonce |
| `7eb86b76` | Update nonce floor cache after successful tx submission |
| `cbe5dc47` | Increase XCN rate limits 10x for Goliath Mainnet (2500 XCN total) |

### Deployment Workflow (IMPORTANT)

**Always push changes to the `main` branch and use the CI-built image.** Never build and deploy custom-tagged images manually.

```bash
# 1. Make changes on a feature/fix branch
git checkout -b fix/my-fix
# ... make changes, commit ...

# 2. Merge to main and push — CI builds the image automatically
git checkout main
git merge fix/my-fix --no-edit
git push origin main

# 3. Wait for CI to complete (~2-3 min)
gh run list --repo crypt0grapher/hiero-json-rpc-relay --workflow=build-relay.yaml --limit=1

# 4. Get the CI-built image digest
gh api /users/crypt0grapher/packages/container/hiero-json-rpc-relay%2Fjson-rpc-relay/versions \
  --jq '.[0] | "\(.metadata.container.tags | join(",")) \(.name)"'

# 5. Deploy using the `main` tag pinned by digest
#    Update ~/goliath/mainnet/k8s/relay/relay-http.yaml and relay-ws.yaml with new digest
#    Apply to all 3 K3s clusters (FRA, ASH, TYO)
```

**CI Image:** `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:main`
**CI Workflow:** `.github/workflows/build-relay.yaml` (triggers on push to `main`)

### Mainnet Relay Deployment

**Clusters:** FRA (`~/.kube/goliath-fra.yaml`), ASH (`~/.kube/goliath-ash.yaml`), TYO (`~/.kube/goliath-tyo.yaml`)
**Namespace:** `goliath-relay`
**Manifests:** `~/goliath/mainnet/k8s/relay/relay-http.yaml`, `relay-ws.yaml`
**Operators:** FRA=0.0.1011, ASH=0.0.1012, TYO=0.0.1013 (per-region, stored in ConfigMaps)

**Pod restart safety:** NEVER use `kubectl rollout restart`. Delete pods one-by-one with 45s sleep between each to avoid containerd overload. Or use `kubectl set image` which triggers a rolling update via the deployment strategy.

### XCN Rate Limits (Goliath defaults)

| Setting | Value | Env Var |
|---------|-------|---------|
| Total budget | 2500 XCN | `HBAR_RATE_LIMIT_TINYBAR=250000000000` |
| BASIC per-user | 30 XCN | `HBAR_RATE_LIMIT_BASIC=3000000000` |
| EXTENDED per-user | 10 XCN | `HBAR_RATE_LIMIT_EXTENDED=1000000000` |
| PRIVILEGED per-user | 27 XCN | `HBAR_RATE_LIMIT_PRIVILEGED=2700000000` |
| Reset interval | 24 hours | `HBAR_RATE_LIMIT_DURATION=86400000` |

Rate limits reset automatically every 24h (midnight UTC). Pod restart also resets limits (HbarLimitService reinitializes).
