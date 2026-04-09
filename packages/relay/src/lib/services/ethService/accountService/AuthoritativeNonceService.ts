// SPDX-License-Identifier: Apache-2.0

import { Logger } from 'pino';

import { parseNumericEnvVar } from '../../../../formatters';
import { MirrorNodeClient } from '../../../clients';
import type { ICacheClient } from '../../../clients/cache/ICacheClient';
import constants from '../../../constants';
import { RequestDetails } from '../../../types';
import { IAccountInfo } from '../../../types/mirrorNode';
import HAPIService from '../../hapiService/hapiService';

export interface AuthoritativeNonceSnapshot {
  consensusNonce: number | null;
  effectiveNonce: number;
  mirrorAccount: IAccountInfo;
  mirrorNonce: number;
  source: 'consensus' | 'mirror';
}

export class AuthoritativeNonceService {
  private readonly cacheTtlMs = parseNumericEnvVar(
    'ETH_GET_TRANSACTION_COUNT_CACHE_TTL',
    'ETH_GET_TRANSACTION_COUNT_CACHE_TTL',
  );

  private readonly consensusTimeoutMs = parseNumericEnvVar(
    'ETH_GET_TRANSACTION_COUNT_CONSENSUS_TIMEOUT_MS',
    'ETH_GET_TRANSACTION_COUNT_CONSENSUS_TIMEOUT_MS',
  );

  private readonly inFlightRequests = new Map<string, Promise<AuthoritativeNonceSnapshot | null>>();
  private readonly consensusLookups = new Map<string, Promise<unknown>>();

  constructor(
    private readonly cacheService: ICacheClient,
    private readonly logger: Logger,
    private readonly mirrorNodeClient: MirrorNodeClient,
    private readonly hapiService: HAPIService,
  ) {}

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
    const consensusNonce = await this.getConsensusNonceSnapshot(
      cacheKey,
      address,
      mirrorAccount.account,
      mirrorNonce,
      requestDetails,
    );

    const snapshot: AuthoritativeNonceSnapshot = {
      consensusNonce,
      effectiveNonce: consensusNonce ?? mirrorNonce,
      mirrorAccount,
      mirrorNonce,
      source: consensusNonce == null ? 'mirror' : 'consensus',
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

  private async getConsensusNonceSnapshot(
    cacheKey: string,
    address: string,
    accountId: string,
    mirrorNonce: number,
    requestDetails: RequestDetails,
  ): Promise<number | null> {
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
        this.logger.warn(
          {
            accountId,
            address,
            consensusLookupTimeoutMs: this.consensusTimeoutMs,
            mirrorNonce,
            requestId: requestDetails.requestId,
          },
          'Consensus ethereum nonce lookup timed out, falling back to mirror nonce',
        );
        return null;
      }

      return this.normalizeNonceValue(consensusResult, mirrorNonce);
    } catch (error: any) {
      this.logger.warn(
        {
          accountId,
          address,
          err: error,
          mirrorNonce,
          requestId: requestDetails.requestId,
        },
        'Failed to retrieve consensus ethereum nonce, falling back to mirror nonce',
      );
      return null;
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
