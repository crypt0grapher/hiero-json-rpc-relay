# Onyx JSON-RPC Relay

JSON-RPC relay for **Onyx Mainnet** — the EVM JSON-RPC layer in front of the Onyx mirror/consensus stack (chain ID `327`, native **XCN**).

This repository is a fork of [Hiero JSON-RPC relay](https://github.com/hiero-ledger/hiero-json-rpc-relay) (Hedera / Hiero stack) with Onyx-specific patches.

## Interact via the EVM layer

This component **is** the recommended integration path for applications:

- HTTP: `https://rpc.onyx.org`
- WebSocket: `wss://ws.onyx.org`

Full developer documentation: **[https://docs.onyx.org/](https://docs.onyx.org/)**

## Network parameters

| Parameter | Value |
|-----------|-------|
| Native token | XCN |
| EVM chain ID (mainnet) | `327` (`0x147`) |
| EVM chain ID (testnet) | `8901` (`0x22c5`) |
| Ledger ID | `0x47` (legacy technical identifier) |

## Upstream

- Upstream: [`hiero-ledger/hiero-json-rpc-relay`](https://github.com/hiero-ledger/hiero-json-rpc-relay)
- Apache 2.0 — retain upstream attribution.

Image and historical repo names under `crypt0grapher/hiero-json-rpc-relay` and `goliath-*` identifiers are **legacy technical identifiers** retained for deployment compatibility; the network name is **Onyx**.

## Deployed mainnet image

Live Onyx Mainnet relay (FRA/ASH/TYO) runs:

```text
ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay@sha256:4765bb826c4484e38d4532a90740ad0040113d724006d4422a3856671cb9f11b
```

Source commit: `c934abd485d0a16d86517d631ee03ce7d9b10f41` (git tag `onyx-mainnet-deployed-c934abd`).

```bash
docker pull ghcr.io/crypt0grapher/hiero-json-rpc-relay/json-rpc-relay@sha256:4765bb826c4484e38d4532a90740ad0040113d724006d4422a3856671cb9f11b
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
