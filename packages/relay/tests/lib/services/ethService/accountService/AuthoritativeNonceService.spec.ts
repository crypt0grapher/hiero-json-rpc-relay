// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import pino from 'pino';
import { Registry } from 'prom-client';
import sinon from 'sinon';

import { MirrorNodeClient } from '../../../../../src/lib/clients';
import type { ICacheClient } from '../../../../../src/lib/clients/cache/ICacheClient';
import { AuthoritativeNonceService } from '../../../../../src/lib/services';
import HAPIService from '../../../../../src/lib/services/hapiService/hapiService';
import { RequestDetails } from '../../../../../src/lib/types';
import { withOverriddenEnvsInMochaTest } from '../../../../helpers';

const logger = pino({ level: 'silent' });

const createCacheClient = (): ICacheClient & { snapshot(): Map<string, unknown> } => {
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
    snapshot() {
      return new Map(store);
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

  let cacheService: ICacheClient & { snapshot(): Map<string, unknown> };
  let hapiServiceStub: sinon.SinonStubbedInstance<HAPIService>;
  let mirrorNodeClientStub: sinon.SinonStubbedInstance<MirrorNodeClient>;
  let registry: Registry;
  let service: AuthoritativeNonceService;

  const buildService = (): AuthoritativeNonceService =>
    new AuthoritativeNonceService(
      cacheService,
      logger,
      mirrorNodeClientStub as unknown as MirrorNodeClient,
      hapiServiceStub as unknown as HAPIService,
      registry,
    );

  const timeoutCounterValue = async (): Promise<number> => {
    const metric = await registry.getSingleMetricAsString('rpc_relay_consensus_nonce_lookup_timeouts_total');
    const match = metric.match(/rpc_relay_consensus_nonce_lookup_timeouts_total\s+(\d+)/);
    return match ? Number(match[1]) : 0;
  };

  beforeEach(() => {
    cacheService = createCacheClient();
    registry = new Registry();
    hapiServiceStub = sinon.createStubInstance(HAPIService);
    mirrorNodeClientStub = sinon.createStubInstance(MirrorNodeClient);
    mirrorNodeClientStub.getAccount.resolves(mirrorAccount);
    hapiServiceStub.getAccountInfo.resolves({
      ethereumNonce: {
        toNumber: () => 7,
      },
    } as any);

    service = buildService();
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

  // task-002 acceptance: consensus 169, mirror 170 → source 'consensus', effectiveNonce 169.
  it('serves the consensus value (169) even when mirror is ahead (170)', async () => {
    mirrorNodeClientStub.getAccount.resolves({ ...mirrorAccount, ethereum_nonce: 170 } as any);
    hapiServiceStub.getAccountInfo.resolves({ ethereumNonce: { toNumber: () => 169 } } as any);

    service = buildService();
    const snapshot = await service.getLatestNonceSnapshot(address, requestDetails);

    expect(snapshot).to.deep.include({
      consensusNonce: 169,
      effectiveNonce: 169,
      mirrorNonce: 170,
      source: 'consensus',
    });
  });

  it('returns the cached snapshot on repeated reads', async () => {
    const firstSnapshot = await service.getLatestNonceSnapshot(address, requestDetails);
    const secondSnapshot = await service.getLatestNonceSnapshot(address, requestDetails);

    expect(secondSnapshot).to.deep.equal(firstSnapshot);
    expect(mirrorNodeClientStub.getAccount.calledOnce).to.be.true;
    expect(hapiServiceStub.getAccountInfo.calledOnce).to.be.true;
  });

  describe('fails closed when consensus is unavailable', () => {
    withOverriddenEnvsInMochaTest({ ETH_GET_TRANSACTION_COUNT_CONSENSUS_TIMEOUT_MS: 25 }, () => {
      // task-002 acceptance: consensus timeout does NOT cache a mirror success
      // snapshot; it surfaces source 'consensus_unavailable' with no usable
      // effectiveNonce.
      it('surfaces consensus_unavailable on a consensus gRPC timeout, never a mirror success snapshot', async () => {
        const clock = sinon.useFakeTimers();
        hapiServiceStub.getAccountInfo.returns(new Promise(() => {}));

        try {
          service = buildService();

          const snapshotPromise = service.getLatestNonceSnapshot(address, requestDetails);
          await clock.tickAsync(25);
          const snapshot = await snapshotPromise;

          expect(snapshot).to.deep.include({
            consensusNonce: null,
            effectiveNonce: null,
            mirrorNonce: 7,
            source: 'consensus_unavailable',
          });
          expect(snapshot!.source).to.not.equal('mirror');
          expect(hapiServiceStub.getAccountInfo.calledOnce).to.be.true;
          expect(await timeoutCounterValue()).to.equal(1);
        } finally {
          clock.restore();
        }
      });

      it('coalesces concurrent timeout-bounded requests behind one mirror and consensus lookup', async () => {
        const clock = sinon.useFakeTimers();
        hapiServiceStub.getAccountInfo.returns(new Promise(() => {}));

        try {
          service = buildService();

          const firstSnapshotPromise = service.getLatestNonceSnapshot(address, requestDetails);
          const secondSnapshotPromise = service.getLatestNonceSnapshot(address, requestDetails);

          await clock.tickAsync(25);
          const [firstSnapshot, secondSnapshot] = await Promise.all([firstSnapshotPromise, secondSnapshotPromise]);

          expect(firstSnapshot).to.deep.equal(secondSnapshot);
          expect(firstSnapshot!.source).to.equal('consensus_unavailable');
          expect(mirrorNodeClientStub.getAccount.calledOnce).to.be.true;
          expect(hapiServiceStub.getAccountInfo.calledOnce).to.be.true;
        } finally {
          clock.restore();
        }
      });
    });

    it('surfaces consensus_unavailable when the consensus gRPC lookup rejects', async () => {
      hapiServiceStub.getAccountInfo.rejects(new Error('gRPC UNAVAILABLE'));
      service = buildService();

      const snapshot = await service.getLatestNonceSnapshot(address, requestDetails);

      expect(snapshot).to.deep.include({
        consensusNonce: null,
        effectiveNonce: null,
        source: 'consensus_unavailable',
      });
      expect(await timeoutCounterValue()).to.equal(1);
    });
  });

  // task-002 acceptance: a non-consensus snapshot is cached only under the
  // tight AUTHORITATIVE_NONCE_MIRROR_FALLBACK_TTL_MS, never the long
  // ETH_GET_TRANSACTION_COUNT_CACHE_TTL.
  describe('mirror-fallback / unavailable-state cache TTL', () => {
    withOverriddenEnvsInMochaTest(
      {
        ETH_GET_TRANSACTION_COUNT_CONSENSUS_TIMEOUT_MS: 25,
        ETH_GET_TRANSACTION_COUNT_CACHE_TTL: 30_000,
        AUTHORITATIVE_NONCE_MIRROR_FALLBACK_TTL_MS: 250,
      },
      () => {
        it('caches a consensus_unavailable snapshot under the short fallback TTL, not the long count TTL', async () => {
          const clock = sinon.useFakeTimers();
          hapiServiceStub.getAccountInfo.returns(new Promise(() => {}));
          const cacheSetSpy = sinon.spy(cacheService, 'set');

          try {
            service = buildService();
            const snapshotPromise = service.getLatestNonceSnapshot(address, requestDetails);
            await clock.tickAsync(25);
            await snapshotPromise;

            expect(cacheSetSpy.calledOnce).to.be.true;
            // 4th positional arg of cacheService.set(...) is the TTL in ms.
            expect(cacheSetSpy.firstCall.args[3]).to.equal(250);
            expect(cacheSetSpy.firstCall.args[3]).to.not.equal(30_000);
          } finally {
            clock.restore();
          }
        });

        it('caches a consensus success snapshot under the long count TTL', async () => {
          const cacheSetSpy = sinon.spy(cacheService, 'set');
          service = buildService();

          await service.getLatestNonceSnapshot(address, requestDetails);

          expect(cacheSetSpy.calledOnce).to.be.true;
          expect(cacheSetSpy.firstCall.args[3]).to.equal(30_000);
        });
      },
    );
  });
});
