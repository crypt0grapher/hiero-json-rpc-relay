# Goliath JSON-RPC Relay

Ethereum JSON-RPC API implementation for the Goliath Network. Fork of [hiero-json-rpc-relay](https://github.com/hiero-ledger/hiero-json-rpc-relay) with Goliath-specific branding, chain IDs, and deployment configuration.

## Chain IDs

| Network          | Chain ID (hex) | Chain ID (decimal) |
|------------------|----------------|--------------------|
| Goliath Mainnet  | `0x147`        | 327                |
| Goliath Testnet  | `0x22c5`       | 8901               |

## Docker Images

Pre-built images are published to GitHub Container Registry on every push.

| Branch   | Docker Image                                                                  | Chain ID |
|----------|-------------------------------------------------------------------------------|----------|
| `main`   | `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:main`              | `0x147`  |
| `testnet`| `ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:testnet`           | `0x22c5` |

### Pulling images

```bash
docker pull ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:main
docker pull ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay:testnet
```

### Building locally

```bash
docker build --platform linux/amd64 -t goliath-relay:latest .
```

## Goliath-specific changes

- **Default chain ID**: `0x147` (Goliath Mainnet) instead of Hedera's `0x12a`
- **Client version**: `web3_clientVersion` returns `goliath-relay/<version>`
- **Fee fixes**: `maxFeePerGas` and `maxPriorityFeePerGas` converted from tinybars to weibars; `baseFeePerGas` uses block-time gas price
- **Upstream base**: merged from `hiero-json-rpc-relay` tag `v0.75.0`

## Quick start

```bash
npm install
npm run build
npm run start        # HTTP server on port 7546
npm run start:ws     # WebSocket server on port 8546
```

### Required environment variables

```bash
CHAIN_ID=0x147                    # 0x147 for mainnet, 0x22c5 for testnet
HEDERA_NETWORK=<network-config>   # JSON map of node IPs or network name
MIRROR_NODE_URL=<mirror-url>      # Mirror Node REST API endpoint
OPERATOR_ID_MAIN=<account-id>     # Operator account ID (e.g. 0.0.1001)
OPERATOR_KEY_MAIN=<private-key>   # Operator private key (DER format)
```

### Verify

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"eth_chainId","params":[]}' \
  http://localhost:7546
# Expected: {"result":"0x147","jsonrpc":"2.0","id":"1"}
```

## Upstream

- **Origin**: `git@github.com:crypt0grapher/hiero-json-rpc-relay.git`
- **Upstream**: `git@github.com:hiero-ledger/hiero-json-rpc-relay.git`
- **Base version**: v0.75.0

## License

[Apache License 2.0](LICENSE)
