// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import pino from 'pino';
import sinon from 'sinon';

import { MirrorNodeClient } from '../../../../../src/lib/clients';
import type { ICacheClient } from '../../../../../src/lib/clients/cache/ICacheClient';
import { AuthoritativeNonceService } from '../../../../../src/lib/services';
import HAPIService from '../../../../../src/lib/services/hapiService/hapiService';
import { RequestDetails } from '../../../../../src/lib/types';
import { withOverriddenEnvsInMochaTest } from '../../../../helpers';

const logger = pino({ level: 'silent' });

const createCacheClient = (): ICacheClient => {
  const store = new Map<string, unknown>();

  return {
    async clear() {
      store.clear();
    },
    async delete(key: string) {
      store.delete(key);
    },
    async get(key: string) {
      return store.has(key) ? store.get(key) : null;
    },
    async getAsync(key: string) {
      return store.has(key) ? store.get(key) : null;
    },
    async incrBy() {
      throw new Error('Not implemented in test cache');
    },
    async keys() {
      return Array.from(store.keys());
    },
    async lRange() {
      return [];
    },
    async rPush() {
      throw new Error('Not implemented in test cache');
    },
    async set(key: string, value: unknown) {
      store.set(key, value);
    },
  };
};

describe('AuthoritativeNonceService', () => {
  const address = '0x00000000000000000000000000000000000003f6';
  const requestDetails = new RequestDetails({ requestId: 'authoritativeNonceServiceTest', ipAddress: '0.0.0.0' });
  const mirrorAccount = {
    account: '0.0.1014',
    balance: {
      balance: 1000000000,
      timestamp: '1654168500.007651338',
      tokens: [],
    },
    ethereum_nonce: 7,
    evm_address: address,
    receiver_sig_required: false,
    transactions: [],
  } as any;

  let cacheService: ICacheClient;
  let hapiServiceStub: sinon.SinonStubbedInstance<HAPIService>;
  let mirrorNodeClientStub: sinon.SinonStubbedInstance<MirrorNodeClient>;
  let service: AuthoritativeNonceService;

  beforeEach(() => {
    cacheService = createCacheClient();
    hapiServiceStub = sinon.createStubInstance(HAPIService);
    mirrorNodeClientStub = sinon.createStubInstance(MirrorNodeClient);
    mirrorNodeClientStub.getAccount.resolves(mirrorAccount);
    hapiServiceStub.getAccountInfo.resolves({
      ethereumNonce: {
        toNumber: () => 7,
      },
    } as any);

    service = new AuthoritativeNonceService(
      cacheService,
      logger,
      mirrorNodeClientStub as unknown as MirrorNodeClient,
      hapiServiceStub as unknown as HAPIService,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it('prefers the consensus nonce when mirror is ahead', async () => {
    mirrorNodeClientStub.getAccount.resolves({ ...mirrorAccount, ethereum_nonce: 8 } as any);

    const snapshot = await service.getLatestNonceSnapshot(address, requestDetails);

    expect(snapshot).to.deep.include({
      consensusNonce: 7,
      effectiveNonce: 7,
      mirrorNonce: 8,
      source: 'consensus',
    });
    expect(mirrorNodeClientStub.getAccount.calledOnce).to.be.true;
    expect(hapiServiceStub.getAccountInfo.calledOnce).to.be.true;
  });

  it('returns the cached snapshot on repeated reads', async () => {
    const firstSnapshot = await service.getLatestNonceSnapshot(address, requestDetails);
    const secondSnapshot = await service.getLatestNonceSnapshot(address, requestDetails);

    expect(secondSnapshot).to.deep.equal(firstSnapshot);
    expect(mirrorNodeClientStub.getAccount.calledOnce).to.be.true;
    expect(hapiServiceStub.getAccountInfo.calledOnce).to.be.true;
  });

  withOverriddenEnvsInMochaTest({ ETH_GET_TRANSACTION_COUNT_CONSENSUS_TIMEOUT_MS: 25 }, () => {
    it('falls back to the mirror nonce when the consensus lookup exceeds the bound', async () => {
      const clock = sinon.useFakeTimers();
      hapiServiceStub.getAccountInfo.returns(new Promise(() => {}));

      try {
        service = new AuthoritativeNonceService(
          cacheService,
          logger,
          mirrorNodeClientStub as unknown as MirrorNodeClient,
          hapiServiceStub as unknown as HAPIService,
        );

        const snapshotPromise = service.getLatestNonceSnapshot(address, requestDetails);
        await clock.tickAsync(25);
        const snapshot = await snapshotPromise;

        expect(snapshot).to.deep.include({
          consensusNonce: null,
          effectiveNonce: 7,
          mirrorNonce: 7,
          source: 'mirror',
        });
        expect(hapiServiceStub.getAccountInfo.calledOnce).to.be.true;
      } finally {
        clock.restore();
      }
    });

    it('coalesces concurrent timeout-bounded requests behind one mirror and consensus lookup', async () => {
      const clock = sinon.useFakeTimers();
      hapiServiceStub.getAccountInfo.returns(new Promise(() => {}));

      try {
        service = new AuthoritativeNonceService(
          cacheService,
          logger,
          mirrorNodeClientStub as unknown as MirrorNodeClient,
          hapiServiceStub as unknown as HAPIService,
        );

        const firstSnapshotPromise = service.getLatestNonceSnapshot(address, requestDetails);
        const secondSnapshotPromise = service.getLatestNonceSnapshot(address, requestDetails);

        await clock.tickAsync(25);
        const [firstSnapshot, secondSnapshot] = await Promise.all([firstSnapshotPromise, secondSnapshotPromise]);

        expect(firstSnapshot).to.deep.equal(secondSnapshot);
        expect(mirrorNodeClientStub.getAccount.calledOnce).to.be.true;
        expect(hapiServiceStub.getAccountInfo.calledOnce).to.be.true;
      } finally {
        clock.restore();
      }
    });
  });
});
