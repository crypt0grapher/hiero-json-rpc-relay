// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'ethers';
import sinon from 'sinon';

import { numberTo0x } from '../../../src/formatters';
import constants from '../../../src/lib/constants';
import { RequestDetails } from '../../../src/lib/types';
import { generateEthTestEnv } from './eth-helpers';

const MIRROR_TIMESTAMP_RANGE_400_BODY = JSON.stringify({
  _status: {
    messages: [
      {
        message:
          'Cannot search topics without a valid timestamp range: Timestamp range by the lower and upper bounds must be positive and within 7d',
      },
    ],
  },
});

describe('@ethGetUserOperationReceipt eth_getUserOperationReceipt tests', async function () {
  this.timeout(10000);

  const { restMock, ethImpl, cacheService } = generateEthTestEnv();
  const requestDetails = new RequestDetails({ requestId: 'eth_getUserOperationReceiptTest', ipAddress: '0.0.0.0' });
  const latestBlockUrl = 'blocks?limit=1&order=desc';

  const entryPoint = ethers.getAddress('0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789');
  const sender = ethers.getAddress('0x6d495cf76114c707fe8b14745e20c8caea534469');
  const paymaster = ethers.getAddress('0xb2aa3511a31327d47d562c292d8b445a900b2abf');
  const userOpHash = '0x0f65f168dd7c90ee91d8c350c9ba2a265b666119bf80b12eccc54a0f3ff73c48';
  const txHash = '0xaa71f6bb57b565d341d730e547b3fa6496be91131011468334c80f529b1578bf';
  const blockHash = `0x${'11'.repeat(32)}`;
  const latestTimestamp = '1776353569.523776806';
  const emptyBloom = constants.EMPTY_BLOOM;

  const entryPointInterface = new ethers.Interface([
    'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
    'event UserOperationRevertReason(bytes32 indexed userOpHash, address indexed sender, uint256 nonce, bytes revertReason)',
  ]);

  const buildContractResult = (logs: Array<{ address: string; data: string; index: number; topics: string[] }>) => ({
    address: entryPoint,
    amount: 0,
    bloom: emptyBloom,
    call_result: '0x',
    contract_id: '0.0.2529',
    created_contract_ids: [],
    error_message: null,
    from: sender,
    function_parameters: '0x',
    gas_limit: 1000000,
    gas_used: 123,
    timestamp: latestTimestamp,
    to: entryPoint,
    block_hash: blockHash,
    block_number: 2593926,
    logs,
    result: 'SUCCESS',
    transaction_index: 0,
    hash: txHash,
    status: '0x1',
    access_list: '0x',
    block_gas_used: 50000000,
    chain_id: '0x147',
    gas_price: '0x4a817c80',
    max_fee_per_gas: '0x',
    max_priority_fee_per_gas: '0x',
    r: null,
    s: null,
    type: 2,
    v: null,
    nonce: 1,
  });

  const timestampToNanos = (timestamp: string): bigint => {
    const [secondsStr, nanosStr = '0'] = timestamp.split('.');
    return BigInt(secondsStr) * constants.NANOS_PER_SECOND + BigInt(nanosStr.padEnd(9, '0'));
  };

  const nanosToTimestamp = (nanos: bigint): string => {
    const seconds = nanos / constants.NANOS_PER_SECOND;
    const remainingNanos = nanos % constants.NANOS_PER_SECOND;
    return `${seconds}.${remainingNanos.toString().padStart(9, '0')}`;
  };

  const buildUserOperationLookupUrl = (lookbackWindowSeconds: number): string => {
    const latestTimestampNanos = timestampToNanos(latestTimestamp);
    const fromTimestamp = nanosToTimestamp(
      latestTimestampNanos - BigInt(lookbackWindowSeconds) * constants.NANOS_PER_SECOND,
    );

    return (
      `contracts/results/logs?timestamp=gte:${fromTimestamp}` +
      `&timestamp=lte:${latestTimestamp}` +
      `&topic0=${entryPointInterface.getEvent('UserOperationEvent').topicHash}` +
      `&topic1=${userOpHash}` +
      `&limit=1&order=asc`
    );
  };

  beforeEach(() => {
    restMock.onGet(latestBlockUrl).reply(
      200,
      JSON.stringify({
        blocks: [
          {
            count: 1,
            gas_used: 0,
            hapi_version: '0.68.6',
            hash: blockHash,
            logs_bloom: emptyBloom,
            name: 'FileUpdate',
            number: 2593926,
            previous_hash: `0x${'22'.repeat(32)}`,
            size: 0,
            timestamp: {
              from: latestTimestamp,
              to: latestTimestamp,
            },
          },
        ],
      }),
    );
    sinon.stub(ethImpl['transactionService']['common'], 'getCurrentGasPriceForBlock').resolves('0xad78ebc5ac620000');
    sinon
      .stub(ethImpl['transactionService']['common'], 'resolveEvmAddress')
      .callsFake(async (address: string) => address);
  });

  afterEach(async () => {
    restMock.resetHandlers();
    sinon.restore();
    await cacheService.clear();
  });

  it('returns null when the user operation log is not found', async function () {
    for (const lookbackWindowSeconds of [300, 3600, 86400, 604799]) {
      restMock
        .onGet(buildUserOperationLookupUrl(lookbackWindowSeconds))
        .reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    }

    const receipt = await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);
    expect(receipt).to.be.null;
  });

  it('returns a bundled receipt for a successful user operation', async function () {
    const encodedUserOperationEvent = entryPointInterface.encodeEventLog(
      entryPointInterface.getEvent('UserOperationEvent'),
      [userOpHash, sender, paymaster, 1n, true, 250000000000000000n, 54321n],
    );

    restMock.onGet(buildUserOperationLookupUrl(300)).reply(
      200,
      JSON.stringify({
        logs: [
          {
            address: entryPoint,
            bloom: emptyBloom,
            contract_id: '0.0.2529',
            data: encodedUserOperationEvent.data,
            index: 0,
            topics: encodedUserOperationEvent.topics,
            block_hash: blockHash,
            block_number: 2593926,
            timestamp: latestTimestamp,
            transaction_hash: txHash,
            transaction_index: 0,
          },
        ],
        links: { next: null },
      }),
    );
    restMock.onGet(`contracts/results/${txHash}`).reply(
      200,
      JSON.stringify(
        buildContractResult([
          {
            address: entryPoint,
            data: encodedUserOperationEvent.data,
            index: 0,
            topics: encodedUserOperationEvent.topics,
          },
        ]),
      ),
    );

    const receipt = await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);

    expect(receipt).to.deep.include({
      actualGasCost: numberTo0x(250000000000000000n),
      actualGasUsed: numberTo0x(54321n),
      entryPoint,
      nonce: numberTo0x(1n),
      paymaster,
      sender,
      success: true,
      userOpHash,
    });
    expect(receipt?.reason).to.be.undefined;
    expect(receipt?.receipt.transactionHash).to.equal(txHash);
    expect(receipt?.logs).to.deep.equal(receipt?.receipt.logs);
  });

  it('widens the timestamp search window until the user operation log is found', async function () {
    const encodedUserOperationEvent = entryPointInterface.encodeEventLog(
      entryPointInterface.getEvent('UserOperationEvent'),
      [userOpHash, sender, paymaster, 3n, true, 1n, 2n],
    );

    restMock.onGet(buildUserOperationLookupUrl(300)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(3600)).reply(
      200,
      JSON.stringify({
        logs: [
          {
            address: entryPoint,
            bloom: emptyBloom,
            contract_id: '0.0.2529',
            data: encodedUserOperationEvent.data,
            index: 0,
            topics: encodedUserOperationEvent.topics,
            block_hash: blockHash,
            block_number: 2593926,
            timestamp: latestTimestamp,
            transaction_hash: txHash,
            transaction_index: 0,
          },
        ],
        links: { next: null },
      }),
    );
    restMock.onGet(`contracts/results/${txHash}`).reply(
      200,
      JSON.stringify(
        buildContractResult([
          {
            address: entryPoint,
            data: encodedUserOperationEvent.data,
            index: 0,
            topics: encodedUserOperationEvent.topics,
          },
        ]),
      ),
    );

    const receipt = await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);

    expect(receipt?.nonce).to.equal(numberTo0x(3n));
    expect(receipt?.actualGasCost).to.equal(numberTo0x(1n));
    expect(receipt?.actualGasUsed).to.equal(numberTo0x(2n));
  });

  it('includes the revert reason log when the user operation failed', async function () {
    const revertReason = '0x08c379a00000000000000000000000000000000000000000000000000000000000000020';
    const encodedUserOperationEvent = entryPointInterface.encodeEventLog(
      entryPointInterface.getEvent('UserOperationEvent'),
      [userOpHash, sender, paymaster, 2n, false, 10000000000000000n, 98765n],
    );
    const encodedRevertReason = entryPointInterface.encodeEventLog(
      entryPointInterface.getEvent('UserOperationRevertReason'),
      [userOpHash, sender, 2n, revertReason],
    );

    restMock.onGet(buildUserOperationLookupUrl(300)).reply(
      200,
      JSON.stringify({
        logs: [
          {
            address: entryPoint,
            bloom: emptyBloom,
            contract_id: '0.0.2529',
            data: encodedUserOperationEvent.data,
            index: 1,
            topics: encodedUserOperationEvent.topics,
            block_hash: blockHash,
            block_number: 2593926,
            timestamp: latestTimestamp,
            transaction_hash: txHash,
            transaction_index: 0,
          },
        ],
        links: { next: null },
      }),
    );
    restMock.onGet(`contracts/results/${txHash}`).reply(
      200,
      JSON.stringify(
        buildContractResult([
          {
            address: entryPoint,
            data: encodedRevertReason.data,
            index: 0,
            topics: encodedRevertReason.topics,
          },
          {
            address: entryPoint,
            data: encodedUserOperationEvent.data,
            index: 1,
            topics: encodedUserOperationEvent.topics,
          },
        ]),
      ),
    );

    const receipt = await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);

    expect(receipt).to.deep.include({
      actualGasCost: numberTo0x(10000000000000000n),
      actualGasUsed: numberTo0x(98765n),
      nonce: numberTo0x(2n),
      success: false,
      userOpHash,
    });
    expect(receipt?.reason).to.equal(revertReason);
    expect(receipt?.logs).to.have.length(2);
  });

  // ---------------------------------------------------------------------------
  // Regression suite for issue 2026-05-02-relay-eth-getuseroperationreceipt-500
  // (HTTP 500 / -32020 on negative-path polls because the 4th lookback window
  //  was 604800s exactly, on the rejected side of mirror's strict `< 7d`.)
  // ---------------------------------------------------------------------------

  it('Test A: returns null when 5m/1h/24h are empty, the buggy 7d-exact lookup returns 400, and the fixed 7d-1s lookup is empty', async function () {
    // Production-like negative path. Pre-fix: handler hits the 604800 URL and the
    // mirror 400 propagates as -32020 -> HTTP 500. Post-fix: handler hits 604799,
    // gets [], resolves to null. Both URLs are mocked so the same test passes
    // before and after the production-code change in task-002.
    restMock.onGet(buildUserOperationLookupUrl(300)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(3600)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(86400)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(604800)).reply(400, MIRROR_TIMESTAMP_RANGE_400_BODY);
    restMock.onGet(buildUserOperationLookupUrl(604799)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));

    const receipt = await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);
    expect(receipt).to.be.null;
  });

  it('Test B: every lookback window passes a strictly-less-than-7d timestamp range to mirror, with the widest window exactly 604799s', async function () {
    restMock.onGet(buildUserOperationLookupUrl(300)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(3600)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(86400)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(604799)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    // Defensive mock — if the bug is still present and a 604800 URL is called we
    // reply with the mirror 400 the production system actually returns, so the
    // assertion below fails with the right diagnostic instead of throwing
    // "no match" deep inside axios-mock-adapter.
    restMock.onGet(buildUserOperationLookupUrl(604800)).reply(400, MIRROR_TIMESTAMP_RANGE_400_BODY);

    // restMock.history accumulates across the entire spec file; clear it so
    // this test only sees its own request log.
    restMock.resetHistory();

    await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);

    const userOpLogCalls = restMock.history.get
      .map((req) => req.url ?? '')
      .filter((url) => url.includes('contracts/results/logs') && url.includes(`topic1=${userOpHash}`));

    expect(userOpLogCalls).to.have.length(4, 'expected exactly 4 lookback windows to be queried');

    const parseDelta = (url: string): number => {
      const params = new URLSearchParams(url.split('?')[1] ?? '');
      const fromRaw = (params.getAll('timestamp').find((v) => v.startsWith('gte:')) ?? '').replace('gte:', '');
      const toRaw = (params.getAll('timestamp').find((v) => v.startsWith('lte:')) ?? '').replace('lte:', '');
      const toNanos = timestampToNanos(toRaw);
      const fromNanos = timestampToNanos(fromRaw);
      return Number((toNanos - fromNanos) / constants.NANOS_PER_SECOND);
    };

    const deltas = userOpLogCalls.map(parseDelta);

    deltas.forEach((delta, idx) => {
      expect(delta, `window #${idx + 1} delta=${delta} must be < 604800`).to.be.lessThan(604800);
    });
    expect(deltas[3], 'widest (4th) window must be exactly 604799s').to.equal(604799);
  });

  it('Test C: a single mirror 400 with "valid timestamp range" on a non-final window is logged and skipped, lookup continues to later windows', async function () {
    const warnSpy = sinon.spy(ethImpl['transactionService']['logger'], 'warn');

    // Force a 400 on the 1h (3600s) window — non-final on purpose so we prove
    // the loop `continue`s rather than just catching once and returning null.
    restMock.onGet(buildUserOperationLookupUrl(300)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(3600)).reply(400, MIRROR_TIMESTAMP_RANGE_400_BODY);
    restMock.onGet(buildUserOperationLookupUrl(86400)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(604799)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(604800)).reply(400, MIRROR_TIMESTAMP_RANGE_400_BODY);

    const receipt = await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);
    expect(receipt).to.be.null;

    const matchedWarnCalls = warnSpy
      .getCalls()
      .filter((call) => call.args.some((arg) => typeof arg === 'string' && /valid timestamp range/i.test(arg)));
    expect(matchedWarnCalls, 'expected exactly one warn-level log for the skipped 400 window').to.have.length(1);
  });

  it('Test D: locates a real receipt within the 7d-1s widest lookback window even when the log is ~6d 23h 50m old', async function () {
    const encodedUserOperationEvent = entryPointInterface.encodeEventLog(
      entryPointInterface.getEvent('UserOperationEvent'),
      [userOpHash, sender, paymaster, 7n, true, 12345n, 67890n],
    );

    // Older block to host the historical log, so receipt.blockHash etc. are sane.
    const olderBlockHash = `0x${'33'.repeat(32)}`;
    const olderTimestampNanos =
      timestampToNanos(latestTimestamp) - BigInt(6 * 86400 + 23 * 3600 + 50 * 60) * constants.NANOS_PER_SECOND;
    const olderTimestamp = nanosToTimestamp(olderTimestampNanos);
    const olderTxHash = '0xdeadbeef'.padEnd(66, '0');

    const widestWindowResponse = JSON.stringify({
      logs: [
        {
          address: entryPoint,
          bloom: emptyBloom,
          contract_id: '0.0.2529',
          data: encodedUserOperationEvent.data,
          index: 0,
          topics: encodedUserOperationEvent.topics,
          block_hash: olderBlockHash,
          block_number: 2593000,
          timestamp: olderTimestamp,
          transaction_hash: olderTxHash,
          transaction_index: 0,
        },
      ],
      links: { next: null },
    });
    restMock.onGet(buildUserOperationLookupUrl(300)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(3600)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(86400)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    // Both URLs are mocked to the same fixture so this test passes against the
    // current (broken) code (which queries 604800) AND the fixed code (604799).
    restMock.onGet(buildUserOperationLookupUrl(604800)).reply(200, widestWindowResponse);
    restMock.onGet(buildUserOperationLookupUrl(604799)).reply(200, widestWindowResponse);
    restMock.onGet(`contracts/results/${olderTxHash}`).reply(
      200,
      JSON.stringify({
        ...buildContractResult([
          {
            address: entryPoint,
            data: encodedUserOperationEvent.data,
            index: 0,
            topics: encodedUserOperationEvent.topics,
          },
        ]),
        block_hash: olderBlockHash,
        block_number: 2593000,
        hash: olderTxHash,
        timestamp: olderTimestamp,
      }),
    );

    const receipt = await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);

    expect(receipt).to.not.be.null;
    expect(receipt).to.deep.include({
      actualGasCost: numberTo0x(12345n),
      actualGasUsed: numberTo0x(67890n),
      entryPoint,
      nonce: numberTo0x(7n),
      paymaster,
      sender,
      success: true,
      userOpHash,
    });
    expect(receipt?.receipt.transactionHash).to.equal(olderTxHash);
  });

  it('Test E: first poll during mirror indexing lag returns null without throwing; second poll returns the real receipt', async function () {
    // First poll: production-like indexing lag. 5m/1h/24h are empty,
    // the buggy 604800 URL would return 400, the fixed 604799 URL returns [].
    restMock.onGet(buildUserOperationLookupUrl(300)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(3600)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(86400)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));
    restMock.onGet(buildUserOperationLookupUrl(604800)).reply(400, MIRROR_TIMESTAMP_RANGE_400_BODY);
    restMock.onGet(buildUserOperationLookupUrl(604799)).reply(200, JSON.stringify({ logs: [], links: { next: null } }));

    const firstPoll = await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);
    expect(firstPoll).to.be.null;

    // Second poll: mirror has now indexed the EntryPoint event log on the 5m
    // window. Reset the 5m and tx-detail mocks; everything else is irrelevant
    // because the loop short-circuits on the first hit.
    restMock.resetHandlers();
    sinon.restore();

    // Re-arm beforeEach scaffolding the suite expects.
    restMock.onGet(latestBlockUrl).reply(
      200,
      JSON.stringify({
        blocks: [
          {
            count: 1,
            gas_used: 0,
            hapi_version: '0.68.6',
            hash: blockHash,
            logs_bloom: emptyBloom,
            name: 'FileUpdate',
            number: 2593926,
            previous_hash: `0x${'22'.repeat(32)}`,
            size: 0,
            timestamp: { from: latestTimestamp, to: latestTimestamp },
          },
        ],
      }),
    );
    sinon.stub(ethImpl['transactionService']['common'], 'getCurrentGasPriceForBlock').resolves('0xad78ebc5ac620000');
    sinon
      .stub(ethImpl['transactionService']['common'], 'resolveEvmAddress')
      .callsFake(async (address: string) => address);

    const encodedUserOperationEvent = entryPointInterface.encodeEventLog(
      entryPointInterface.getEvent('UserOperationEvent'),
      [userOpHash, sender, paymaster, 9n, true, 1n, 2n],
    );

    restMock.onGet(buildUserOperationLookupUrl(300)).reply(
      200,
      JSON.stringify({
        logs: [
          {
            address: entryPoint,
            bloom: emptyBloom,
            contract_id: '0.0.2529',
            data: encodedUserOperationEvent.data,
            index: 0,
            topics: encodedUserOperationEvent.topics,
            block_hash: blockHash,
            block_number: 2593926,
            timestamp: latestTimestamp,
            transaction_hash: txHash,
            transaction_index: 0,
          },
        ],
        links: { next: null },
      }),
    );
    restMock.onGet(`contracts/results/${txHash}`).reply(
      200,
      JSON.stringify(
        buildContractResult([
          {
            address: entryPoint,
            data: encodedUserOperationEvent.data,
            index: 0,
            topics: encodedUserOperationEvent.topics,
          },
        ]),
      ),
    );

    const secondPoll = await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);
    expect(secondPoll).to.not.be.null;
    expect(secondPoll?.userOpHash).to.equal(userOpHash);
    expect(secondPoll?.nonce).to.equal(numberTo0x(9n));
  });
});
