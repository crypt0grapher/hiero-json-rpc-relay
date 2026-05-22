// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';
import { Counter, Registry } from 'prom-client';

import { parseNumericEnvVar } from '../../../../formatters';
import { MirrorNodeClient } from '../../../clients';
import type { ICacheClient } from '../../../clients/cache/ICacheClient';
import constants from '../../../constants';
import { RequestDetails } from '../../../types';
import { IAccountInfo } from '../../../types/mirrorNode';
import HAPIService from '../../hapiService/hapiService';

/**
 * Authoritative nonce snapshot.
 *
 * `source` discriminates how `effectiveNonce` was resolved:
 *  - `'consensus'`            — consensus-side gRPC `AccountInfoQuery` returned a
 *                               nonce; this is the authoritative value.
 *  - `'mirror'`               — an explicit, compatibility-only mirror fallback
 *                               was used; bounded by a tight cache TTL
 *                               (`AUTHORITATIVE_NONCE_MIRROR_FALLBACK_TTL_MS`).
 *  - `'consensus_unavailable'` — the consensus gRPC lookup timed out / failed.
 *                               The service fails closed: `consensusNonce` and
 *                               `effectiveNonce` are both `null` (no usable
 *                               nonce). Callers MUST surface a temporary error
 *                               instead of serving a mirror-derived value.
 *
 * Fail-closed is intentional: mirror's `entity.ethereum_nonce` can drift AHEAD
 * of consensus by 1 on certain CFR shapes (importer `signerNonce+1` line
 * `9dd4810ff`). Silently caching a mirror-derived nonce as authoritative when
 * consensus is unavailable is exactly the residual leak this task closes.
 */
export interface AuthoritativeNonceSnapshot {
  consensusNonce: number | null;
  effectiveNonce: number | null;
  mirrorAccount: IAccountInfo;
  mirrorNonce: number;
  source: 'consensus' | 'mirror' | 'consensus_unavailable';
}

/**
 * Internal discriminated result of a single consensus-side nonce lookup.
 *  - `available: true`  → consensus returned a nonce.
 *  - `available: false` → consensus timed out or failed; caller fails closed.
 */
type ConsensusNonceLookupResult = { available: true; nonce: number } | { available: false };

export class AuthoritativeNonceService {
  private readonly cacheTtlMs = parseNumericEnvVar(
    'ETH_GET_TRANSACTION_COUNT_CACHE_TTL',
    'ETH_GET_TRANSACTION_COUNT_CACHE_TTL',
  );

  /**
   * Tight cache TTL applied to `'mirror'` and `'consensus_unavailable'`
   * snapshots so any drift / outage state expires fast and back-to-back reads
   * do not hammer consensus while it is down. Never the long
   * `ETH_GET_TRANSACTION_COUNT_CACHE_TTL`.
   */
  private readonly mirrorFallbackTtlMs = parseNumericEnvVar(
    'AUTHORITATIVE_NONCE_MIRROR_FALLBACK_TTL_MS',
    'AUTHORITATIVE_NONCE_MIRROR_FALLBACK_TTL_MS',
  );

  private readonly consensusTimeoutMs = parseNumericEnvVar(
    'ETH_GET_TRANSACTION_COUNT_CONSENSUS_TIMEOUT_MS',
    'ETH_GET_TRANSACTION_COUNT_CONSENSUS_TIMEOUT_MS',
  );

  private readonly inFlightRequests = new Map<string, Promise<AuthoritativeNonceSnapshot | null>>();
  private readonly consensusLookups = new Map<string, Promise<unknown>>();

  /**
   * Incremented on every consensus-side gRPC nonce lookup timeout / failure.
   * A sustained non-zero rate means consensus is unreachable and clients are
   * being fail-closed (HTTP 503). Drives the `RelayConsensusNonceLookupTimeoutHigh`
   * alert.
   */
  private readonly consensusNonceLookupTimeouts: Counter;

  constructor(
    private readonly cacheService: ICacheClient,
    private readonly logger: Logger,
    private readonly mirrorNodeClient: MirrorNodeClient,
    private readonly hapiService: HAPIService,
    register: Registry = new Registry(),
  ) {
    const metricName = 'rpc_relay_consensus_nonce_lookup_timeouts_total';
    register.removeSingleMetric(metricName);
    this.consensusNonceLookupTimeouts = new Counter({
      name: metricName,
      help:
        'Counter for consensus-side gRPC AccountInfoQuery nonce lookup ' +
        'timeouts/failures in AuthoritativeNonceService. A non-zero rate means ' +
        'eth_getTransactionCount / send-time precheck are failing closed ' +
        '(HTTP 503) instead of serving a potentially-drifted mirror nonce.',
      registers: [register],
    });
  }

  public async getLatestNonceSnapshot(
    address: string,
    requestDetails: RequestDetails,
  ): Promise<AuthoritativeNonceSnapshot | null> {
    const cacheKey = this.getCacheKey(address);
    const cachedSnapshot = await this.cacheService.getAsync<AuthoritativeNonceSnapshot | null>(
      cacheKey,
      constants.ETH_GET_TRANSACTION_COUNT,
    );

    if (cachedSnapshot != null) {
      return cachedSnapshot;
    }

    const inFlightRequest = this.inFlightRequests.get(cacheKey);
    if (inFlightRequest) {
      return inFlightRequest;
    }

    const snapshotRequest = this.fetchLatestNonceSnapshot(address, requestDetails).finally(() => {
      this.inFlightRequests.delete(cacheKey);
    });

    this.inFlightRequests.set(cacheKey, snapshotRequest);
    return snapshotRequest;
  }

  private async fetchLatestNonceSnapshot(
    address: string,
    requestDetails: RequestDetails,
  ): Promise<AuthoritativeNonceSnapshot | null> {
    const cacheKey = this.getCacheKey(address);
    const mirrorAccount = await this.mirrorNodeClient.getAccount(address, requestDetails);
    if (mirrorAccount == null) {
      return null;
    }

    const mirrorNonce = this.normalizeNonceValue(mirrorAccount.ethereum_nonce, 1);
    const consensusResult = await this.getConsensusNonceSnapshot(
      cacheKey,
      address,
      mirrorAccount.account,
      mirrorNonce,
      requestDetails,
    );

    // Fail closed: when the consensus lookup is unavailable we do NOT cache a
    // mirror-derived success snapshot under the long ETH_GET_TRANSACTION_COUNT
    // TTL. We surface `source: 'consensus_unavailable'` with no usable
    // `effectiveNonce` so downstream eth_getTransactionCount / precheck return
    // a temporary error (HTTP 503). The state itself is cached only under the
    // tight `mirrorFallbackTtlMs` so concurrent reads do not hammer consensus
    // while it is down, and so recovery is observed within one short TTL.
    if (!consensusResult.available) {
      const unavailableSnapshot: AuthoritativeNonceSnapshot = {
        consensusNonce: null,
        effectiveNonce: null,
        mirrorAccount,
        mirrorNonce,
        source: 'consensus_unavailable',
      };

      await this.cacheService.set(
        cacheKey,
        unavailableSnapshot,
        constants.ETH_GET_TRANSACTION_COUNT,
        this.mirrorFallbackTtlMs,
      );

      return unavailableSnapshot;
    }

    const snapshot: AuthoritativeNonceSnapshot = {
      consensusNonce: consensusResult.nonce,
      effectiveNonce: consensusResult.nonce,
      mirrorAccount,
      mirrorNonce,
      source: 'consensus',
    };

    await this.cacheService.set(cacheKey, snapshot, constants.ETH_GET_TRANSACTION_COUNT, this.cacheTtlMs);

    return snapshot;
  }

  private getOrCreateConsensusLookup(
    cacheKey: string,
    accountId: string,
    requestDetails: RequestDetails,
  ): Promise<unknown> {
    const inFlightLookup = this.consensusLookups.get(cacheKey);
    if (inFlightLookup) {
      return inFlightLookup;
    }

    const consensusLookup = this.hapiService
      .getAccountInfo(accountId, requestDetails, this.getLatestNonceSnapshot.name)
      .then((accountInfo) => accountInfo.ethereumNonce)
      .finally(() => {
        this.consensusLookups.delete(cacheKey);
      });

    this.consensusLookups.set(cacheKey, consensusLookup);
    return consensusLookup;
  }

  /**
   * Performs the timeout-bounded consensus-side nonce lookup.
   *
   * Returns a discriminated result rather than `number | null` so the caller
   * can tell apart "consensus returned a nonce" from "consensus unavailable"
   * and fail closed for the latter. Every timeout / failure increments
   * `rpc_relay_consensus_nonce_lookup_timeouts_total`.
   */
  private async getConsensusNonceSnapshot(
    cacheKey: string,
    address: string,
    accountId: string,
    mirrorNonce: number,
    requestDetails: RequestDetails,
  ): Promise<ConsensusNonceLookupResult> {
    const consensusLookup = this.getOrCreateConsensusLookup(cacheKey, accountId, requestDetails);
    const timeoutToken = Symbol('authoritative-nonce-timeout');
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const consensusResult = await Promise.race<unknown | typeof timeoutToken>([
        consensusLookup,
        new Promise<typeof timeoutToken>((resolve) => {
          timeoutId = setTimeout(() => resolve(timeoutToken), this.consensusTimeoutMs);
        }),
      ]);

      if (consensusResult === timeoutToken) {
        // Evict the coalescing entry: the underlying gRPC promise has NOT
        // settled (its `.finally()` has not run), so leaving it in
        // `consensusLookups` would make every subsequent lookup for this
        // account coalesce onto the same wedged promise and time out forever
        // (the JVM `:9999`-style metrics-handler wedge is a real Goliath
        // failure mode). Evicting lets the next request issue a fresh lookup.
        this.consensusLookups.delete(cacheKey);
        this.consensusNonceLookupTimeouts.inc();
        this.logger.warn(
          {
            accountId,
            address,
            consensusLookupTimeoutMs: this.consensusTimeoutMs,
            mirrorNonce,
            requestId: requestDetails.requestId,
          },
          'Consensus ethereum nonce lookup timed out; failing closed (eth_getTransactionCount / precheck will return a temporary error)',
        );
        return { available: false };
      }

      // Consensus RESPONDED (this is not a timeout / error path). A missing or
      // null `ethereumNonce` here is a legitimate answer — pre-HIP-729 entities
      // (contracts) do not track an ethereum nonce — so we fall back to the
      // mirror-derived value as the second argument to `normalizeNonceValue`.
      // This is distinct from `available: false`, which is reserved strictly
      // for the timeout / thrown-error paths where consensus said nothing at
      // all and we must fail closed.
      return { available: true, nonce: this.normalizeNonceValue(consensusResult, mirrorNonce) };
    } catch (error: any) {
      this.consensusNonceLookupTimeouts.inc();
      this.logger.warn(
        {
          accountId,
          address,
          err: error,
          mirrorNonce,
          requestId: requestDetails.requestId,
        },
        'Failed to retrieve consensus ethereum nonce; failing closed (eth_getTransactionCount / precheck will return a temporary error)',
      );
      return { available: false };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private getCacheKey(address: string): string {
    return `${constants.CACHE_KEY.ETH_GET_TRANSACTION_COUNT}:authoritative:${address.toLowerCase()}`;
  }

  private normalizeNonceValue(rawNonce: unknown, fallback: number): number {
    if (rawNonce == null) {
      return fallback;
    }

    if (typeof rawNonce === 'number') {
      return rawNonce;
    }

    if (typeof rawNonce === 'bigint') {
      return Number(rawNonce);
    }

    if (typeof rawNonce === 'string') {
      const parsedNonce = Number(rawNonce);
      return Number.isNaN(parsedNonce) ? fallback : parsedNonce;
    }

    if (typeof rawNonce === 'object' && rawNonce !== null && 'toNumber' in rawNonce) {
      const longLikeNonce = rawNonce as { toNumber: () => number };
      return longLikeNonce.toNumber();
    }

    const parsedNonce = Number(rawNonce);
    return Number.isNaN(parsedNonce) ? fallback : parsedNonce;
  }
}
