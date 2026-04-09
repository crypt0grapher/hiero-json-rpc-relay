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

  private readonly inFlightRequests = new Map<string, Promise<AuthoritativeNonceSnapshot | null>>();

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
    let consensusNonce: number | null = null;

    try {
      const accountInfo = await this.hapiService.getAccountInfo(
        mirrorAccount.account,
        requestDetails,
        this.getLatestNonceSnapshot.name,
      );
      consensusNonce = this.normalizeNonceValue(accountInfo.ethereumNonce, mirrorNonce);
    } catch (error: any) {
      this.logger.warn(
        {
          accountId: mirrorAccount.account,
          address,
          err: error,
          mirrorNonce,
          requestId: requestDetails.requestId,
        },
        'Failed to retrieve consensus ethereum nonce, falling back to mirror nonce',
      );
    }

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
