// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';
import { ethers } from 'ethers';
import sinon from 'sinon';

import { numberTo0x } from '../../../src/formatters';
import constants from '../../../src/lib/constants';
import { RequestDetails } from '../../../src/lib/types';
import { generateEthTestEnv } from './eth-helpers';

describe('@ethGetUserOperationReceipt eth_getUserOperationReceipt tests', async function () {
  this.timeout(10000);

  const { restMock, ethImpl, cacheService } = generateEthTestEnv();
  const requestDetails = new RequestDetails({ requestId: 'eth_getUserOperationReceiptTest', ipAddress: '0.0.0.0' });

  const entryPoint = ethers.getAddress('0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789');
  const sender = ethers.getAddress('0x6d495cf76114c707fe8b14745e20c8caea534469');
  const paymaster = ethers.getAddress('0xb2aa3511a31327d47d562c292d8b445a900b2abf');
  const userOpHash = '0x0f65f168dd7c90ee91d8c350c9ba2a265b666119bf80b12eccc54a0f3ff73c48';
  const txHash = '0xaa71f6bb57b565d341d730e547b3fa6496be91131011468334c80f529b1578bf';
  const blockHash = `0x${'11'.repeat(32)}`;
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
    timestamp: '1776353569.523776806',
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

  beforeEach(() => {
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
    restMock
      .onGet(
        `contracts/results/logs?topic0=${entryPointInterface.getEvent('UserOperationEvent').topicHash}&topic1=${userOpHash}&limit=1&order=asc`,
      )
      .reply(200, JSON.stringify({ logs: [], links: { next: null } }));

    const receipt = await ethImpl.getUserOperationReceipt(userOpHash, requestDetails);
    expect(receipt).to.be.null;
  });

  it('returns a bundled receipt for a successful user operation', async function () {
    const encodedUserOperationEvent = entryPointInterface.encodeEventLog(
      entryPointInterface.getEvent('UserOperationEvent'),
      [userOpHash, sender, paymaster, 1n, true, 250000000000000000n, 54321n],
    );

    restMock
      .onGet(
        `contracts/results/logs?topic0=${entryPointInterface.getEvent('UserOperationEvent').topicHash}&topic1=${userOpHash}&limit=1&order=asc`,
      )
      .reply(
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
              timestamp: '1776353569.523776806',
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

    restMock
      .onGet(
        `contracts/results/logs?topic0=${entryPointInterface.getEvent('UserOperationEvent').topicHash}&topic1=${userOpHash}&limit=1&order=asc`,
      )
      .reply(
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
              timestamp: '1776353569.523776806',
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
});
