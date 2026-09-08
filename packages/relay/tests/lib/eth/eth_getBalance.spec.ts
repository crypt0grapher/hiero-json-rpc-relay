// SPDX-License-Identifier: Apache-2.0

import { ConfigService } from '@hashgraph/json-rpc-config-service/dist/services';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import JSONBigInt from 'json-bigint';
import sinon from 'sinon';

import { ConfigServiceTestHelper } from '../../../../config-service/tests/configServiceTestHelper';
import { numberTo0x } from '../../../dist/formatters';
import constants from '../../../src/lib/constants';
import { RequestDetails } from '../../../src/lib/types';
import { buildCryptoTransferTransaction, LONG_ZERO_ADDRESS, overrideEnvsInMochaDescribe } from '../../helpers';
import {
  ACCOUNT_ADDRESS_1,
  BLOCK_TIMESTAMP,
  BLOCK_ZERO,
  BLOCKS_LIMIT_ORDER_URL,
  CONTRACT_ADDRESS_1,
  CONTRACT_ID_1,
  DEF_BALANCE,
  DEF_HEX_BALANCE,
  DEFAULT_BLOCK,
  DEFAULT_NETWORK_FEES,
  ENTITY_ZERO_ADDRESS,
  LONG_ZERO_CONTRACT_TWIN_ADDRESS,
  LONG_ZERO_ENTRYPOINT_ADDRESS,
  LONG_ZERO_KEEP_98_ADDRESS,
  LONG_ZERO_TWIN_ADDRESS,
  MOCK_ACCOUNT_ENTRYPOINT_TWIN,
  MOCK_ACCOUNT_KEEP_98,
  MOCK_ACCOUNT_KEEP_LIST,
  MOCK_ACCOUNT_TWIN,
  MOCK_BALANCE_RES,
  MOCK_BLOCK_NUMBER_1000_RES,
  MOCK_BLOCKS_FOR_BALANCE_RES,
  MOCK_CONTRACT_TWIN,
  NO_TRANSACTIONS,
  NOT_FOUND_RES,
  TINYBAR_TO_WEIBAR_COEF_BIGINT,
} from './eth-config';
import { balancesByAccountIdByTimestampURL, generateEthTestEnv } from './eth-helpers';

use(chaiAsPromised);

describe('@ethGetBalance using MirrorNode', async function () {
  this.timeout(10000);
  const { restMock, ethImpl, cacheService, registry } = generateEthTestEnv();

  const requestDetails = new RequestDetails({ requestId: 'eth_getBalanceTest', ipAddress: '0.0.0.0' });

  overrideEnvsInMochaDescribe({ ETH_GET_TRANSACTION_COUNT_MAX_BLOCK_RANGE: 1 });

  this.beforeEach(async () => {
    // reset cache and restMock
    await cacheService.clear(requestDetails);
    restMock.reset();

    restMock.onGet('network/fees').reply(200, JSON.stringify(DEFAULT_NETWORK_FEES));
  });

  this.afterEach(() => {
    restMock.resetHandlers();
  });

  it('should return balance from mirror node', async () => {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCK_NUMBER_1000_RES));
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?transactions=false`).reply(200, JSON.stringify(MOCK_BALANCE_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, 'latest', requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);
  });

  it('should return balance from mirror node with block number passed as param the same as latest', async () => {
    const blockNumber = '0x2710';
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?transactions=false`).reply(200, JSON.stringify(MOCK_BALANCE_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, blockNumber, requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);
  });

  it('should return balance from mirror node with block hash passed as param the same as latest', async () => {
    const blockHash = '0x43da6a71f66d6d46d2b487c8231c04f01b3ba3bd91d165266d8eb39de3c0152b';
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
    restMock.onGet(`blocks/${blockHash}`).reply(
      200,
      JSON.stringify({
        number: 10000,
      }),
    );
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?transactions=false`).reply(200, JSON.stringify(MOCK_BALANCE_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, blockHash, requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);
  });

  it('should return balance from mirror node with block number passed as param, one behind latest', async () => {
    const blockNumber = '0x270F';
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?transactions=false`).reply(200, JSON.stringify(MOCK_BALANCE_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, blockNumber, requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);
  });

  it('should return balance from mirror node with block hash passed as param, one behind latest', async () => {
    const blockHash = '0x43da6a71f66d6d46d2b487c8231c04f01b3ba3bd91d165266d8eb39de3c0152b';
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
    restMock.onGet(`blocks/${blockHash}`).reply(
      200,
      JSON.stringify({
        number: 9998,
        timestamp: {
          from: '1651550386',
        },
      }),
    );

    restMock.onGet(balancesByAccountIdByTimestampURL(CONTRACT_ADDRESS_1, '1651550386')).reply(
      200,
      JSON.stringify({
        account: CONTRACT_ADDRESS_1,
        balances: [
          {
            balance: DEF_BALANCE,
          },
        ],
      }),
    );

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, blockHash, requestDetails);
    expect(resBalance).to.equal(DEF_HEX_BALANCE);
  });

  it('should return balance from consensus node', async () => {
    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCK_NUMBER_1000_RES));
    restMock.onGet(`contracts/${CONTRACT_ADDRESS_1}`).reply(200, JSON.stringify(null));
    restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?transactions=false`).reply(404, JSON.stringify(NOT_FOUND_RES));

    const resBalance = await ethImpl.getBalance(CONTRACT_ADDRESS_1, 'latest', requestDetails);
    expect(resBalance).to.equal(constants.ZERO_HEX);
  });

  it('should return cached balance for a specific block number if mirror node is unavailable', async () => {
    const blockNumber = '0x1';
    restMock.onGet('blocks/1').reply(200, JSON.stringify(DEFAULT_BLOCK));

    restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(
      200,
      JSON.stringify({
        blocks: [
          {
            number: 3,
            timestamp: {
              from: `${BLOCK_TIMESTAMP}.060890919`,
              to: '1651560389.060890949',
            },
          },
        ],
      }),
    );

    restMock.onGet(`accounts/${ACCOUNT_ADDRESS_1}?limit=100`).reply(
      200,
      JSON.stringify({
        account: CONTRACT_ID_1,
        balance: {
          balance: DEF_BALANCE,
        },
        transactions: [
          buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${BLOCK_TIMESTAMP}.002391010` }),
          buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: `${BLOCK_TIMESTAMP}.002392003` }),
          buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: `${BLOCK_TIMESTAMP}.980350003` }),
        ],
        links: {
          next: null,
        },
      }),
    );

    const resNoCache = await ethImpl.getBalance(ACCOUNT_ADDRESS_1, blockNumber, requestDetails);

    restMock.onGet(`accounts/${ACCOUNT_ADDRESS_1}?limit=100`).reply(404, JSON.stringify(NOT_FOUND_RES));

    const resCached = await ethImpl.getBalance(ACCOUNT_ADDRESS_1, blockNumber, requestDetails);
    expect(resNoCache).to.equal(DEF_HEX_BALANCE);
    expect(resCached).to.equal(DEF_HEX_BALANCE);
  });

  describe('with blockNumberOrTag filter', async function () {
    const balance1 = 99960581131;
    const balance2 = 99960581132;
    const balance3 = 99960581133;
    const timestamp1 = 1651550386;
    const timestamp2 = 1651560286;
    const timestamp3 = 1651560386;
    const timestamp4 = 1651561386;

    const hexBalance1 = numberTo0x(BigInt(balance1) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
    const hexBalance3 = numberTo0x(BigInt(balance3) * TINYBAR_TO_WEIBAR_COEF_BIGINT);

    const latestBlock = {
      ...DEFAULT_BLOCK,
      number: 4,
      timestamp: {
        from: `${timestamp3}.060890949`,
        to: `${timestamp4}.060890949`,
      },
    };

    const recentBlock = {
      ...DEFAULT_BLOCK,
      number: 2,
      timestamp: {
        from: `${timestamp2}.060890949`,
        to: `${timestamp3}.060890949`,
      },
    };

    const earlierBlock = {
      ...DEFAULT_BLOCK,
      number: 1,
      timestamp: {
        from: `${timestamp1}.060890949`,
        to: `${timestamp2}.060890949`,
      },
    };

    beforeEach(async () => {
      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify({ blocks: [latestBlock] }));
      restMock.onGet(`blocks/3`).reply(200, JSON.stringify(DEFAULT_BLOCK));
      restMock.onGet(`blocks/0`).reply(200, JSON.stringify(BLOCK_ZERO));
      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlock));
      restMock.onGet(`blocks/1`).reply(200, JSON.stringify(earlierBlock));

      restMock.onGet(`accounts/${CONTRACT_ID_1}?transactions=false`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${timestamp4}.060890949`,
          },
          transactions: [],
        }),
      );

      restMock.onGet(balancesByAccountIdByTimestampURL(CONTRACT_ID_1, earlierBlock.timestamp.from)).reply(
        200,
        JSON.stringify({
          timestamp: `${timestamp1}.060890949`,
          balances: [
            {
              account: CONTRACT_ID_1,
              balance: balance1,
              tokens: [],
            },
          ],
          links: {
            next: null,
          },
        }),
      );

      restMock.onGet(balancesByAccountIdByTimestampURL(CONTRACT_ID_1, recentBlock.timestamp.from)).reply(
        200,
        JSON.stringify({
          timestamp: `${timestamp2}.060890949`,
          balances: [
            {
              account: CONTRACT_ID_1,
              balance: balance2,
              tokens: [],
            },
          ],
          links: {
            next: null,
          },
        }),
      );

      restMock.onGet(balancesByAccountIdByTimestampURL(CONTRACT_ID_1)).reply(
        200,
        JSON.stringify({
          timestamp: `${timestamp4}.060890949`,
          balances: [
            {
              account: CONTRACT_ID_1,
              balance: balance3,
              tokens: [],
            },
          ],
          links: {
            next: null,
          },
        }),
      );

      restMock.onGet(balancesByAccountIdByTimestampURL(CONTRACT_ID_1, BLOCK_ZERO.timestamp.from)).reply(
        200,
        JSON.stringify({
          timestamp: null,
          balances: [],
          links: {
            next: null,
          },
        }),
      );
    });

    it('latest', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, 'latest', requestDetails);
      expect(resBalance).to.equal(hexBalance3);
    });

    it('finalized', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, 'finalized', requestDetails);
      expect(resBalance).to.equal(hexBalance3);
    });

    it('safe', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, 'safe', requestDetails);
      expect(resBalance).to.equal(hexBalance3);
    });

    it('earliest', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, 'earliest', requestDetails);
      expect(resBalance).to.equal('0x0');
    });

    it('pending', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, 'pending', requestDetails);
      expect(resBalance).to.equal(hexBalance3);
    });

    it('blockNumber is in the latest 15 minutes and the block.timstamp.to is later than the consensus transactions timestamps', async () => {
      const fromTimestamp = '1651560934';
      const toTimestamp = '1651560935';
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 2,
        timestamp: {
          from: `${fromTimestamp}.002391003`,
          to: `${toTimestamp}.980351003`,
        },
      };

      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));

      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${BLOCK_TIMESTAMP}.060890960`,
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${fromTimestamp}.002391010` }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: `${fromTimestamp}.002392003` }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: `${fromTimestamp}.980350003` }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '2', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is not in the latest 15 minutes', async () => {
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${timestamp4}.060890949`,
          },
          transactions: [],
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '1', requestDetails);
      expect(resBalance).to.equal(hexBalance1);
    });

    it('blockNumber is in the latest 15 minutes and there have been several debit transactions with consensus.timestamps greater the block.timestamp.to', async () => {
      const blockTimestamp = '1651560900';
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 2,
        timestamp: {
          from: '1651560899.060890921',
          to: `${blockTimestamp}.060890941`,
        },
      };
      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${blockTimestamp}.060890960`,
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${blockTimestamp}.060890954` }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: `${blockTimestamp}.060890953` }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: `${blockTimestamp}.060890952` }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '2', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 - 175) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is in the latest 15 minutes and there have been several credit transactions with consensus.timestamps greater the block.timestamp.to', async () => {
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 2,
        timestamp: {
          from: '1651560899.060890921',
          to: '1651560900.060890941',
        },
      };

      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${timestamp4}.060890960`,
          },
          transactions: [
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 100, { timestamp: '1651561386.060890954' }),
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: '1651561386.060890953' }),
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 25, { timestamp: '1651561386.060890952' }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '2', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 + 175) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is in the latest 15 minutes and there have been mixed credit and debit transactions with consensus.timestamps greater the block.timestamp.to', async () => {
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 2,
        timestamp: {
          from: '1651560899.060890921',
          to: '1651560900.060890941',
        },
      };

      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: `${timestamp4}.060890960`,
          },
          transactions: [
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 100, { timestamp: '1651561386.060890954' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: '1651561386.060890953' }),
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 25, { timestamp: '1651561386.060890952' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 10, { timestamp: '1651561386.060890951' }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '2', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 + 65) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is in the latest 15 minutes and there have been mixed credit and debit transactions and a next pagination with a timestamp less than the block.timestamp.to', async () => {
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 1,
        timestamp: {
          from: '1651550584.060890921',
          to: '1651550585.060890941',
        },
      };
      restMock.onGet(`blocks/1`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: '1651550587.060890941',
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: '1651550587.060890964' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 55, { timestamp: '1651550587.060890958' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: '1651550587.060890953' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: '1651550587.060890952' }),
          ],
          links: {
            next: `/api/v1/accounts/${CONTRACT_ID_1}?limit=100&timestamp=lt:1651550575.060890941`,
          },
        }),
      );

      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(
        200,
        JSON.stringify({
          blocks: [
            {
              ...DEFAULT_BLOCK,
              number: 4,
              timestamp: {
                from: '1651550595.060890941',
                to: '1651550597.060890941',
              },
            },
          ],
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '1', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 - 230) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is in the latest 15 minutes with debit transactions and a next pagination with a timestamp greater than the block.timestamp.to', async () => {
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 1,
        timestamp: {
          from: '1651550564.060890921',
          to: '1651550565.060890941',
        },
      };

      restMock.onGet(`blocks/1`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: '1651550587.060890941',
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: '1651550587.060890964' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 55, { timestamp: '1651550587.060890958' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: '1651550587.060890953' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: '1651550587.060890952' }),
          ],
          links: {
            next: `/api/v1/accounts/${CONTRACT_ID_1}?limit=100&timestamp=lt:1651550575.060890941`,
          },
        }),
      );

      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100&timestamp=lt:1651550575.060890941`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: '1651550587.060890941',
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 200, { timestamp: '1651550574.060890964' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: '1651550573.060890958' }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const latestBlock = {
        ...DEFAULT_BLOCK,
        number: 4,
        timestamp: {
          from: '1651550595.060890941',
          to: '1651550597.060890941',
        },
      };

      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(
        200,
        JSON.stringify({
          blocks: [latestBlock],
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '1', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 - 480) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is in the latest 15 minutes with credit and debit transactions and a next pagination with a timestamp greater than the block.timestamp.to', async () => {
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 1,
        timestamp: {
          from: '1651550564.060890921',
          to: '1651550565.060890941',
        },
      };
      restMock.onGet(`blocks/1`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: '1651550587.060890941',
          },
          transactions: [
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 100, { timestamp: '1651550587.060890964' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 55, { timestamp: '1651550587.060890958' }),
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: '1651550587.060890953' }),
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 25, { timestamp: '1651550587.060890952' }),
          ],
          links: {
            next: `/api/v1/accounts/${CONTRACT_ID_1}?limit=100&timestamp=lt:1651550575.060890941`,
          },
        }),
      );

      restMock.onGet(`accounts/${CONTRACT_ID_1}?limit=100&timestamp=lt:1651550575.060890941`).reply(
        200,
        JSON.stringify({
          account: CONTRACT_ID_1,
          balance: {
            balance: balance3,
            timestamp: '1651550587.060890941',
          },
          transactions: [
            buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 200, { timestamp: '1651550574.060890964' }),
            buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: '1651550573.060890958' }),
          ],
          links: {
            next: null,
          },
        }),
      );

      const latestBlock = {
        ...DEFAULT_BLOCK,
        number: 4,
        timestamp: {
          from: '1651550595.060890941',
          to: '1651550597.060890941',
        },
      };

      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(
        200,
        JSON.stringify({
          blocks: [latestBlock],
        }),
      );

      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '1', requestDetails);
      const historicalBalance = numberTo0x(BigInt(balance3 - 80) * TINYBAR_TO_WEIBAR_COEF_BIGINT);
      expect(resBalance).to.equal(historicalBalance);
    });

    it('blockNumber is the same as the latest block', async () => {
      const resBalance = await ethImpl.getBalance(CONTRACT_ID_1, '3', requestDetails);
      expect(resBalance).to.equal(hexBalance3);
    });

    it('blockNumber is not in the latest 15 minutes, mirror node balance for address not found 404 status', async () => {
      // random evm address
      const notFoundEvmAddress = '0x1234567890123456789012345678901234567890';
      restMock
        .onGet(balancesByAccountIdByTimestampURL(notFoundEvmAddress, '1651550386.060890949'))
        .reply(404, JSON.stringify(NOT_FOUND_RES));

      const resBalance = await ethImpl.getBalance(notFoundEvmAddress, '1', requestDetails);
      expect(resBalance).to.equal(constants.ZERO_HEX);
    });

    it('blockNumber is in the latest 15 minutes, mirror node balance for address not found 404 status', async () => {
      // random evm address
      const notFoundEvmAddress = '0x1234567890123456789012345678901234567890';
      const blockTimestamp = '1651560900';
      const recentBlockWithinLastfifteen = {
        ...DEFAULT_BLOCK,
        number: 2,
        timestamp: {
          from: '1651560899.060890921',
          to: `${blockTimestamp}.060890941`,
        },
      };
      restMock.onGet(`blocks/2`).reply(200, JSON.stringify(recentBlockWithinLastfifteen));
      restMock.onGet(`accounts/${notFoundEvmAddress}?transactions=false`).reply(404, JSON.stringify(NOT_FOUND_RES));
      restMock.onGet(`accounts/${notFoundEvmAddress}?limit=100`).reply(404, JSON.stringify(NOT_FOUND_RES));

      const resBalance = await ethImpl.getBalance(notFoundEvmAddress, '2', requestDetails);
      expect(resBalance).to.equal(constants.ZERO_HEX);
    });
  });

  describe('recent historical balance integer precision', () => {
    // Keep large fixture integers as decimal text until the real mirror parser reads them.
    const observedBalance = '4304292742935231650';
    const blockTimestamp = '1651560900.060890950';
    const afterBlockTimestamp = '1651560900.060890951';
    const accountUrl = `accounts/${CONTRACT_ADDRESS_1}?limit=100`;
    const nextPage = `/api/v1/accounts/${CONTRACT_ADDRESS_1}?limit=100&timestamp=lt:1651560901.060890950`;
    const transaction = (amounts: string[], timestamp = afterBlockTimestamp) =>
      `{"consensus_timestamp":"${timestamp}","transfers":[${amounts
        .map((amount) => `{"account":"${CONTRACT_ID_1}","amount":${amount},"is_approval":false}`)
        .join(',')}]}`;
    const accountResponse = (transactions: string[], next: string | null = null, balance = observedBalance) =>
      `{"account":"${CONTRACT_ID_1}","balance":{"balance":${balance}},"transactions":[${transactions.join(',')}],"links":{"next":${JSON.stringify(next)}}}`;

    beforeEach(() => {
      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(
        200,
        JSON.stringify({
          blocks: [{ ...DEFAULT_BLOCK, number: 4, timestamp: { from: '1651561000', to: '1651561001' } }],
        }),
      );
      restMock.onGet('blocks/2').reply(
        200,
        JSON.stringify({
          ...DEFAULT_BLOCK,
          number: 2,
          timestamp: { from: '1651560899.060890950', to: blockTimestamp },
        }),
      );
    });

    it('preserves the exact observed 4304292742935231650 tinybar balance with empty transfers', async () => {
      const raw = accountResponse([]);
      expect(typeof JSONBigInt.parse(raw).balance.balance).to.equal('object');
      restMock.onGet(`accounts/${CONTRACT_ADDRESS_1}?transactions=false`).reply(200, raw);
      restMock.onGet(accountUrl).reply(200, raw);

      const latest = await ethImpl.getBalance(CONTRACT_ADDRESS_1, 'latest', requestDetails);
      const historical = await ethImpl.getBalance(CONTRACT_ADDRESS_1, '0x2', requestDetails);
      expect(latest).to.equal('0x8b14466b73b541c580f64800');
      expect(historical).to.equal(latest);
    });

    for (const amount of ['9007199254740993', '-9007199254740993']) {
      it(`preserves a signed transfer of ${amount} tinybars above Number.MAX_SAFE_INTEGER`, async () => {
        restMock.onGet(accountUrl).reply(200, accountResponse([transaction([amount])]));
        const historical = await ethImpl.getBalance(CONTRACT_ADDRESS_1, '0x2', requestDetails);
        expect(historical).to.equal(
          numberTo0x((BigInt(observedBalance) - BigInt(amount)) * TINYBAR_TO_WEIBAR_COEF_BIGINT),
        );
      });
    }

    it('sums mixed parser Number and BigNumber positive/negative transfers without coercion', async () => {
      const raw = transaction(['9007199254740993', '-9007199254740995', '7', '-2']);
      const parsed = JSONBigInt.parse(raw);
      expect(typeof parsed.transfers[0].amount).to.equal('object');
      expect(typeof parsed.transfers[2].amount).to.equal('number');
      const adjustment = ethImpl['accountService']['getBalanceAtBlockTimestamp'](
        CONTRACT_ID_1,
        [parsed],
        blockTimestamp,
      );
      expect(adjustment).to.equal(BigInt(3));

      restMock.onGet(accountUrl).reply(200, accountResponse([raw]));
      expect(await ethImpl.getBalance(CONTRACT_ADDRESS_1, '0x2', requestDetails)).to.equal(
        numberTo0x((BigInt(observedBalance) - BigInt(3)) * TINYBAR_TO_WEIBAR_COEF_BIGINT),
      );
    });

    it('preserves approval, account and timestamp filtering for large transfers', async () => {
      const excluded = `{"consensus_timestamp":"${afterBlockTimestamp}","transfers":[
        {"account":"${CONTRACT_ID_1}","amount":9007199254740993,"is_approval":true},
        {"account":"0.0.98","amount":-9007199254740995,"is_approval":false}]}`;
      restMock
        .onGet(accountUrl)
        .reply(
          200,
          accountResponse([excluded, transaction(['9007199254740993'], '1651560899.060890950'), transaction(['5'])]),
        );
      expect(await ethImpl.getBalance(CONTRACT_ADDRESS_1, '0x2', requestDetails)).to.equal(
        numberTo0x((BigInt(observedBalance) - BigInt(5)) * TINYBAR_TO_WEIBAR_COEF_BIGINT),
      );
    });

    it('sums large transfers across the existing historical pagination path', async () => {
      restMock.onGet(accountUrl).reply(200, accountResponse([transaction(['9007199254740993'])], nextPage));
      restMock
        .onGet(nextPage.replace('/api/v1/', ''))
        .reply(
          200,
          accountResponse([
            transaction(['-9007199254740995', '7']),
            transaction(['9007199254740993'], '1651560899.060890950'),
          ]),
        );
      expect(await ethImpl.getBalance(CONTRACT_ADDRESS_1, '0x2', requestDetails)).to.equal(
        numberTo0x((BigInt(observedBalance) - BigInt(5)) * TINYBAR_TO_WEIBAR_COEF_BIGINT),
      );
      expect(restMock.history.get.filter((request) => request.url === nextPage.replace('/api/v1/', ''))).to.have.length(
        1,
      );
    });

    it('keeps exact large balances while stopping before a long irrelevant account-history tail', async () => {
      const olderCursor = `/api/v1/accounts/${CONTRACT_ADDRESS_1}?limit=100&timestamp=lt:${blockTimestamp}`;
      restMock
        .onGet(accountUrl)
        .reply(200, accountResponse([transaction(['9007199254740993'], '1651560901.060890950')], nextPage));
      restMock
        .onGet(nextPage.replace('/api/v1/', ''))
        .reply(
          200,
          accountResponse(
            [
              transaction(['-9007199254740995', '7']),
              transaction(['9007199254740993'], blockTimestamp),
              transaction(['-9007199254740993'], '1651560900.060890949'),
            ],
            olderCursor,
          ),
        );
      // This older tail would exceed the generic pager's cap if it were followed.
      for (let index = 0; index <= constants.MAX_MIRROR_NODE_PAGINATION; index++) {
        const cursor =
          index === 0
            ? olderCursor
            : `/api/v1/accounts/${CONTRACT_ADDRESS_1}?limit=100&timestamp=lt:1651560899.${900000000 - index}`;
        const following = `/api/v1/accounts/${CONTRACT_ADDRESS_1}?limit=100&timestamp=lt:1651560899.${899999999 - index}`;
        restMock
          .onGet(cursor.replace('/api/v1/', ''))
          .reply(200, accountResponse([transaction(['1'], `1651560899.${899999999 - index}`)], following));
      }

      expect(await ethImpl.getBalance(CONTRACT_ADDRESS_1, '0x2', requestDetails)).to.equal(
        numberTo0x((BigInt(observedBalance) - BigInt(5)) * TINYBAR_TO_WEIBAR_COEF_BIGINT),
      );
      const accountRequests = restMock.history.get.filter((request) => request.url?.startsWith('accounts/'));
      expect(accountRequests.map((request) => request.url)).to.deep.equal([
        accountUrl,
        nextPage.replace('/api/v1/', ''),
      ]);
    });

    it('returns bigint zero for an empty transfer history and preserves small Number balances', async () => {
      expect(ethImpl['accountService']['getBalanceAtBlockTimestamp'](CONTRACT_ID_1, [], blockTimestamp)).to.equal(
        BigInt(0),
      );
      restMock.onGet(accountUrl).reply(200, accountResponse([], null, '123'));
      expect(await ethImpl.getBalance(CONTRACT_ADDRESS_1, '0x2', requestDetails)).to.equal(
        numberTo0x(BigInt(123) * TINYBAR_TO_WEIBAR_COEF_BIGINT),
      );
    });
  });

  describe('cutoff-aware recent historical account pagination', () => {
    const cutoff = '1788825000.123456789';
    const accountService = ethImpl['accountService'];
    const client = accountService['mirrorNodeClient'];
    const link = (timestamp: string, operator = 'lt', account = CONTRACT_ID_1) =>
      `/api/v1/accounts/${account}?limit=100&timestamp=${operator}:${timestamp}`;
    const page = (timestamp: string, next: string | null = null, account = CONTRACT_ID_1) => ({
      account,
      transactions: [{ consensus_timestamp: timestamp, transfers: [] }],
      links: { next },
    });
    const paginate = (next: string, timestamp = cutoff) =>
      accountService['getPagedTransactions'](next, { timestamp: { to: timestamp } }, requestDetails, CONTRACT_ID_1);
    let getAccount: sinon.SinonStub;

    beforeEach(() => {
      getAccount = sinon.stub(client, 'getAccount');
    });

    afterEach(() => {
      getAccount.restore();
    });

    for (const operator of ['lt', 'lte']) {
      for (const timestamp of ['1788825000.123456788', cutoff]) {
        it(`does not fetch ${operator}:${timestamp} at or below the inclusive cutoff`, async () => {
          expect(await paginate(link(timestamp, operator))).to.deep.equal([]);
          expect(getAccount.callCount).to.equal(0);
        });
      }

      it(`fetches a ${operator} cursor one nanosecond after the cutoff`, async () => {
        getAccount.resolves(page(cutoff));
        expect(await paginate(link('1788825000.123456790', operator))).to.have.length(1);
        expect(getAccount.callCount).to.equal(1);
      });
    }

    it('normalizes equivalent fractional cursor and cutoff timestamps exactly', async () => {
      expect(await paginate(link('1788825000.1'), '1788825000.100000000')).to.deep.equal([]);
      expect(await paginate(link('1788825000.100000000'), '1788825000.1')).to.deep.equal([]);
      expect(getAccount.callCount).to.equal(0);
      getAccount.resolves(page('1788825000.100000000'));
      expect(await paginate(link('1788825000.100000001'), '1788825000.1')).to.have.length(1);
      expect(getAccount.callCount).to.equal(1);
    });

    it('stops after reaching the cutoff even when more than twenty older pages are advertised', async () => {
      const olderPages = Array.from({ length: constants.MAX_MIRROR_NODE_PAGINATION + 5 }, (_, index) =>
        page(`1788824999.${String(900000000 - index).padStart(9, '0')}`, link(`1788824999.${900000000 - index}`)),
      );
      getAccount.onCall(0).resolves(page('1788825000.123456790', link('1788825000.123456788')));
      olderPages.forEach((response, index) => getAccount.onCall(index + 1).resolves(response));
      const result = await paginate(link('1788825000.123456791'));
      expect(result).to.have.length(1);
      expect(getAccount.callCount).to.equal(1);
    });

    for (const terminal of [false, true]) {
      it(`handles exactly twenty additional pages with ${terminal ? 'a terminal page' : 'a cutoff-proven stop'}`, async () => {
        for (let index = 0; index < constants.MAX_MIRROR_NODE_PAGINATION; index++) {
          const timestamp = `1788825000.${900000000 - index}`;
          const next =
            index === constants.MAX_MIRROR_NODE_PAGINATION - 1 ? (terminal ? null : link(cutoff)) : link(timestamp);
          getAccount.onCall(index).resolves(page(timestamp, next));
        }
        expect(await paginate(link('1788825000.900000001'))).to.have.length(constants.MAX_MIRROR_NODE_PAGINATION);
        expect(getAccount.callCount).to.equal(constants.MAX_MIRROR_NODE_PAGINATION);
      });
    }

    it('fails closed at the page cap when more relevant transactions are still required', async () => {
      for (let index = 0; index <= constants.MAX_MIRROR_NODE_PAGINATION; index++) {
        const timestamp = `1788825000.${900000000 - index}`;
        getAccount.onCall(index).resolves(page(timestamp, link(timestamp)));
      }
      await expect(paginate(link('1788825000.900000001'))).to.be.rejectedWith(
        `Exceeded maximum mirror node pagination count: ${constants.MAX_MIRROR_NODE_PAGINATION}`,
      );
      expect(getAccount.callCount).to.equal(constants.MAX_MIRROR_NODE_PAGINATION);
    });

    it('allows the descending lte-to-lt tightening at the same nanosecond once', async () => {
      const timestamp = '1788825000.900000000';
      getAccount.onCall(0).resolves(page(timestamp, link(timestamp)));
      getAccount.onCall(1).resolves(page('1788825000.899999999'));
      expect(await paginate(link(timestamp, 'lte'))).to.have.length(2);
      expect(getAccount.callCount).to.equal(2);
    });

    for (const next of [
      link('1788825000.900000000'),
      link('1788825000.9'),
      link('1788825000.900000000', 'lte'),
      link('1788825000.900000001'),
    ]) {
      it(`rejects a repeated, relaxed or ascending continuation ${next}`, async () => {
        getAccount.resolves(page('1788825000.899999999', next));
        await expect(paginate(link('1788825000.900000000'))).to.be.rejected;
        expect(getAccount.callCount).to.equal(1);
      });
    }

    it('rejects a repeated cursor after one equal-timestamp lte-to-lt tightening', async () => {
      const timestamp = '1788825000.900000000';
      getAccount.onCall(0).resolves(page(timestamp, link(timestamp)));
      getAccount.onCall(1).resolves(page('1788825000.899999999', link(timestamp)));
      await expect(paginate(link(timestamp, 'lte'))).to.be.rejected;
      expect(getAccount.callCount).to.equal(2);
    });

    for (const next of [
      `/api/v1/accounts/${CONTRACT_ID_1}?limit=100`,
      link('not-a-timestamp'),
      link('1788825000.1234567890'),
      link('1788825001', 'gt'),
      `${link('1788825001')}&timestamp=lt:1788825000`,
      `${link('1788825001')}&order=asc`,
    ]) {
      it(`rejects an invalid or ambiguous first cursor ${next}`, async () => {
        await expect(paginate(next)).to.be.rejected;
        expect(getAccount.callCount).to.equal(0);
      });

      it(`rejects an invalid or ambiguous later cursor ${next}`, async () => {
        getAccount.resolves(page('1788825001.000000000', next));
        await expect(paginate(link('1788825002'))).to.be.rejected;
        expect(getAccount.callCount).to.equal(1);
      });
    }

    it('rejects a cursor that switches away from the original account', async () => {
      getAccount.resolves(page('1788825000.800000000', link('1788825000.800000000', 'lt', '0.0.98')));
      await expect(paginate(link('1788825000.900000000'))).to.be.rejected;
      expect(getAccount.callCount).to.equal(1);
    });

    it('rejects an initial cursor for an unrelated account before making a request', async () => {
      await expect(paginate(link('1788825000.900000000', 'lt', '0.0.98'))).to.be.rejected;
      expect(getAccount.callCount).to.equal(0);
    });

    it('accepts the originally requested EVM alias while checking the canonical response account', async () => {
      getAccount.resolves(page('1788825000.800000000'));
      expect(
        await accountService['getPagedTransactions'](
          link('1788825000.900000000', 'lt', CONTRACT_ADDRESS_1),
          { timestamp: { to: cutoff } },
          requestDetails,
          CONTRACT_ID_1,
          CONTRACT_ADDRESS_1,
        ),
      ).to.have.length(1);
      expect(getAccount.callCount).to.equal(1);
    });

    it('rejects a page whose canonical account differs from the original response account', async () => {
      getAccount.resolves(page('1788825000.800000000', null, '0.0.98'));
      await expect(paginate(link('1788825000.900000000'))).to.be.rejected;
      expect(getAccount.callCount).to.equal(1);
    });

    it('continues through an empty page with a strictly decreasing cursor', async () => {
      getAccount.onCall(0).resolves({
        account: CONTRACT_ID_1,
        transactions: [],
        links: { next: link('1788825000.800000000') },
      });
      getAccount.onCall(1).resolves(page('1788825000.700000000'));
      expect(await paginate(link('1788825000.900000000'))).to.have.length(1);
      expect(getAccount.callCount).to.equal(2);
    });

    it('accepts an empty terminal page', async () => {
      getAccount.resolves({ account: CONTRACT_ID_1, transactions: [], links: { next: null } });
      expect(await paginate(link('1788825000.900000000'))).to.deep.equal([]);
      expect(getAccount.callCount).to.equal(1);
    });

    it('rejects an empty page with a repeated cursor', async () => {
      const cursor = link('1788825000.900000000');
      getAccount.resolves({ account: CONTRACT_ID_1, transactions: [], links: { next: cursor } });
      await expect(paginate(cursor)).to.be.rejected;
      expect(getAccount.callCount).to.equal(1);
    });

    for (const response of [
      null,
      { account: CONTRACT_ID_1, transactions: null, links: { next: null } },
      { account: CONTRACT_ID_1, transactions: [], links: {} },
      { account: CONTRACT_ID_1, transactions: [], links: { next: 123 } },
      { account: CONTRACT_ID_1, transactions: Array(101).fill({ transfers: [] }), links: { next: null } },
    ]) {
      it(`rejects a malformed or oversized account page ${JSON.stringify(response)?.slice(0, 100)}`, async () => {
        getAccount.resolves(response);
        await expect(paginate(link('1788825000.900000000'))).to.be.rejected;
        expect(getAccount.callCount).to.equal(1);
      });
    }
  });

  describe('inclusive recent historical block boundary', () => {
    const cutoff = '1788825000.123456789';
    const transfer = (timestamp: string, amount: string) =>
      `{"consensus_timestamp":"${timestamp}","transfers":[{"account":"${CONTRACT_ID_1}","amount":${amount},"is_approval":false}]}`;
    const rewind = (transactions: string[], timestamp = cutoff) =>
      ethImpl['accountService']['getBalanceAtBlockTimestamp'](
        CONTRACT_ID_1,
        JSONBigInt.parse(`[${transactions.join(',')}]`),
        timestamp,
      );

    it('rewinds only transactions strictly after the inclusive end, preserving one-nanosecond ordering', () => {
      expect(
        rewind([transfer('1788825000.123456788', '1'), transfer(cutoff, '2'), transfer('1788825000.123456790', '4')]),
      ).to.equal(BigInt(4));
    });

    for (const amount of ['9007199254740993', '-9007199254740993']) {
      it(`keeps the signed int64 transfer ${amount} at block end and rewinds it one nanosecond later`, () => {
        expect(rewind([transfer(cutoff, amount)])).to.equal(BigInt(0));
        expect(rewind([transfer('1788825000.123456790', amount)])).to.equal(BigInt(amount));
      });
    }

    it('normalizes equivalent fractional timestamps without converting to Number', () => {
      expect(rewind([transfer('1788825000.100000000', '2')], '1788825000.1')).to.equal(BigInt(0));
      expect(rewind([transfer('1788825000.100000001', '4')], '1788825000.1')).to.equal(BigInt(4));
    });

    it('rejects a Number cutoff that has already lost its nanoseconds', () => {
      expect(() => rewind([transfer(cutoff, '2')], Number(cutoff) as any)).to.throw();
    });

    it('keeps the native-2 debit at the actual one-transaction block end', async () => {
      const nativeTwo = '0x0000000000000000000000000000000000000002';
      const blockEnd = '1788828472.669264000';
      restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(
        200,
        JSON.stringify({
          blocks: [{ ...DEFAULT_BLOCK, number: 5887056, timestamp: { from: '1788828495', to: '1788828496' } }],
        }),
      );
      restMock
        .onGet('blocks/5887052')
        .reply(200, JSON.stringify({ ...DEFAULT_BLOCK, number: 5887052, timestamp: { from: blockEnd, to: blockEnd } }));
      restMock.onGet(`accounts/${nativeTwo}?limit=100`).reply(
        200,
        `{"account":"0.0.2","balance":{"balance":2402686580865963492},"transactions":[
          {"consensus_timestamp":"${blockEnd}","transfers":[{"account":"0.0.2","amount":-1,"is_approval":false}]}],
          "links":{"next":null}}`,
      );
      expect(await ethImpl.getBalance(nativeTwo, '0x59d44c', requestDetails)).to.equal('0x4da28ebd636924eca84b1000');
    });
  });

  describe('Calculate balance at block timestamp via getBalanceAtBlockTimestamp', async function () {
    const timestamp1 = 1651550386;

    it('Given a blockNumber, return the account balance at that blocknumber, with transactions that debit the account balance', async () => {
      const transactionsInBlockTimestamp: any[] = [
        buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${timestamp1}.060890955` }),
        buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 50, { timestamp: `${timestamp1}.060890954` }),
      ];

      const resultingUpdate = ethImpl['accountService']['getBalanceAtBlockTimestamp'](
        CONTRACT_ID_1,
        transactionsInBlockTimestamp,
        `${timestamp1}.060890950`,
      );
      // Only transactions strictly after timestamp.to are subtracted from the current balance.
      expect(resultingUpdate).to.equal(BigInt(150));
    });

    it('Given a blockNumber, return the account balance at that blocknumber, with transactions that credit the account balance', async () => {
      const transactionsInBlockTimestamp: any[] = [
        buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 100, { timestamp: `${timestamp1}.060890955` }),
        buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: `${timestamp1}.060890954` }),
      ];

      const resultingUpdate = ethImpl['accountService']['getBalanceAtBlockTimestamp'](
        CONTRACT_ID_1,
        transactionsInBlockTimestamp,
        `${timestamp1}.060890950`,
      );
      // Only transactions strictly after timestamp.to are subtracted from the current balance.
      expect(resultingUpdate).to.equal(BigInt(-150));
    });

    it('Given a blockNumber, return the account balance at that blocknumber, with transactions that debit and credit the account balance', async () => {
      const transactionsInBlockTimestamp: any[] = [
        buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${timestamp1}.060890955` }),
        buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: `${timestamp1}.060890954` }),
      ];

      const resultingUpdate = ethImpl['accountService']['getBalanceAtBlockTimestamp'](
        CONTRACT_ID_1,
        transactionsInBlockTimestamp,
        `${timestamp1}.060890950`,
      );
      // Only transactions strictly after timestamp.to are subtracted from the current balance.
      expect(resultingUpdate).to.equal(BigInt(50));
    });

    it('Given a blockNumber, return the account balance at that blocknumber, with transactions that debit, credit, and debit the account balance', async () => {
      const transactionsInBlockTimestamp: any[] = [
        buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 100, { timestamp: `${timestamp1}.060890955` }),
        buildCryptoTransferTransaction(CONTRACT_ID_1, '0.0.98', 50, { timestamp: `${timestamp1}.060890954` }),
        buildCryptoTransferTransaction('0.0.98', CONTRACT_ID_1, 20, { timestamp: `${timestamp1}.060890955` }),
      ];

      const resultingUpdate = ethImpl['accountService']['getBalanceAtBlockTimestamp'](
        CONTRACT_ID_1,
        transactionsInBlockTimestamp,
        `${timestamp1}.060890950`,
      );
      // Only transactions strictly after timestamp.to are subtracted from the current balance.
      expect(resultingUpdate).to.equal(BigInt(70));
    });
  });

  describe('long-zero twin policy U1–U17', async function () {
    const accountsUrl = (address: string) => `accounts/${address}${NO_TRANSACTIONS}`;

    const accountRequestUrls = () =>
      restMock.history.get.map((entry) => entry.url ?? '').filter((url) => url.includes('accounts/'));

    const balancesRequestUrls = () =>
      restMock.history.get.map((entry) => entry.url ?? '').filter((url) => url.includes('balances?account.id='));

    const decisionCount = async (decision: string, uaClass?: string): Promise<number> => {
      const metric = registry.getSingleMetric('rpc_relay_long_zero_twin_total');
      if (!metric) {
        return 0;
      }
      const data = await metric.get();
      return data.values
        .filter(
          (value) =>
            value.labels.decision === decision &&
            value.labels.method === 'eth_getBalance' &&
            (uaClass === undefined || value.labels.ua_class === uaClass),
        )
        .reduce((sum, value) => sum + value.value, 0);
    };

    describe('U1 flag off / absent', () => {
      overrideEnvsInMochaDescribe({ LONG_ZERO_TWIN_POLICY: 'off' });

      it('U1 keep-list long-zero returns real balance with exactly one accounts/ request', async () => {
        restMock.onGet(accountsUrl(LONG_ZERO_ADDRESS)).reply(200, JSON.stringify(MOCK_ACCOUNT_KEEP_LIST));

        const resBalance = await ethImpl.getBalance(LONG_ZERO_ADDRESS, 'latest', requestDetails);
        expect(resBalance).to.equal(DEF_HEX_BALANCE);
        expect(accountRequestUrls()).to.have.lengthOf(1);
        expect(await decisionCount('would_suppress')).to.equal(0);
        expect(await decisionCount('suppressed')).to.equal(0);
      });
    });

    describe('balance mode', () => {
      overrideEnvsInMochaDescribe({ LONG_ZERO_TWIN_POLICY: 'balance' });

      it('U2 twin returns 0x0 and increments suppressed', async () => {
        const before = await decisionCount('suppressed');
        restMock.onGet(accountsUrl(LONG_ZERO_TWIN_ADDRESS)).reply(200, JSON.stringify(MOCK_ACCOUNT_TWIN));

        const resBalance = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, 'latest', requestDetails);
        expect(resBalance).to.equal(constants.ZERO_HEX);
        expect(await decisionCount('suppressed')).to.equal(before + 1);
      });

      it('U3 contract twin returns 0x0', async () => {
        restMock.onGet(accountsUrl(LONG_ZERO_CONTRACT_TWIN_ADDRESS)).reply(200, JSON.stringify(MOCK_CONTRACT_TWIN));

        const resBalance = await ethImpl.getBalance(LONG_ZERO_CONTRACT_TWIN_ADDRESS, 'latest', requestDetails);
        expect(resBalance).to.equal(constants.ZERO_HEX);
      });

      it('U4 keep-list evm_address equals input (any case) returns real balance', async () => {
        const beforeKeep = await decisionCount('keep_passthrough');
        const input = '0x0000000000000000000000000000000000000abc';
        restMock.onGet(accountsUrl(input)).reply(
          200,
          JSON.stringify({
            account: '0.0.2748',
            balance: { balance: DEF_BALANCE },
            evm_address: '0x0000000000000000000000000000000000000AbC',
          }),
        );

        const resBalance = await ethImpl.getBalance(input, 'latest', requestDetails);
        expect(resBalance).to.equal(DEF_HEX_BALANCE);
        expect(await decisionCount('keep_passthrough')).to.equal(beforeKeep + 1);
      });

      it('U4b keep-list 0x…0062 returns real balance', async () => {
        const beforeKeep = await decisionCount('keep_passthrough');
        restMock.onGet(accountsUrl(LONG_ZERO_KEEP_98_ADDRESS)).reply(200, JSON.stringify(MOCK_ACCOUNT_KEEP_98));

        const resBalance = await ethImpl.getBalance(LONG_ZERO_KEEP_98_ADDRESS, 'latest', requestDetails);
        expect(resBalance).to.equal(DEF_HEX_BALANCE);
        expect(await decisionCount('keep_passthrough')).to.equal(beforeKeep + 1);
      });

      it('U5 null evm_address is unresolved and returns real balance', async () => {
        const beforeUnresolved = await decisionCount('unresolved');
        const beforeKeep = await decisionCount('keep_passthrough');
        restMock.onGet(accountsUrl(LONG_ZERO_TWIN_ADDRESS)).reply(
          200,
          JSON.stringify({
            account: '0.0.1083',
            balance: { balance: DEF_BALANCE },
            evm_address: null,
          }),
        );

        const resBalance = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, 'latest', requestDetails);
        expect(resBalance).to.equal(DEF_HEX_BALANCE);
        expect(await decisionCount('unresolved')).to.equal(beforeUnresolved + 1);
        expect(await decisionCount('keep_passthrough')).to.equal(beforeKeep);
      });

      it('U6 mirror 404 returns existing 0x0 and does not increment suppressed', async () => {
        const before = await decisionCount('suppressed');
        restMock.onGet(accountsUrl(LONG_ZERO_TWIN_ADDRESS)).reply(404, JSON.stringify(NOT_FOUND_RES));

        const resBalance = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, 'latest', requestDetails);
        expect(resBalance).to.equal(constants.ZERO_HEX);
        expect(await decisionCount('suppressed')).to.equal(before);
      });

      it('U7 getAccount 500s then 200 fail-opens to the real balance', async () => {
        const before = await decisionCount('suppressed');
        const client = ethImpl['accountService']['mirrorNodeClient'];
        const stub = sinon.stub(client, 'getAccount');
        stub.onFirstCall().rejects(new Error('after retries'));
        stub.onSecondCall().resolves(MOCK_ACCOUNT_TWIN);

        try {
          const resBalance = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, 'latest', requestDetails);
          expect(resBalance).to.equal(DEF_HEX_BALANCE);
          expect(await decisionCount('suppressed')).to.equal(before);
          expect(stub.callCount).to.equal(2);
        } finally {
          stub.restore();
        }
      });

      it('U8 canonical address returns real balance with no extra guard request', async () => {
        restMock.onGet(accountsUrl(ACCOUNT_ADDRESS_1)).reply(200, JSON.stringify(MOCK_BALANCE_RES));

        const resBalance = await ethImpl.getBalance(ACCOUNT_ADDRESS_1, 'latest', requestDetails);
        expect(resBalance).to.equal(DEF_HEX_BALANCE);
        expect(accountRequestUrls()).to.have.lengthOf(1);
      });

      it('U9 historical twin >15 min behind returns 0x0 without balances?account.id=', async () => {
        restMock.onGet(accountsUrl(LONG_ZERO_TWIN_ADDRESS)).reply(200, JSON.stringify(MOCK_ACCOUNT_TWIN));
        restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
        restMock.onGet('blocks/8000').reply(
          200,
          JSON.stringify({
            number: 8000,
            timestamp: {
              from: `${Number(BLOCK_TIMESTAMP) - 2000}.060890919`,
              to: `${Number(BLOCK_TIMESTAMP) - 2000}.060890949`,
            },
          }),
        );

        const resBalance = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, '0x1f40', requestDetails);
        expect(resBalance).to.equal(constants.ZERO_HEX);
        expect(balancesRequestUrls()).to.be.empty;
      });

      it('U10 entity 0 plus 404 returns existing 0x0', async () => {
        restMock.onGet(accountsUrl(ENTITY_ZERO_ADDRESS)).reply(404, JSON.stringify(NOT_FOUND_RES));

        const resBalance = await ethImpl.getBalance(ENTITY_ZERO_ADDRESS, 'latest', requestDetails);
        expect(resBalance).to.equal(constants.ZERO_HEX);
        expect(constants.LONG_ZERO_ADDRESS_REGEX.test(ENTITY_ZERO_ADDRESS)).to.be.true;
        expect(BigInt(ENTITY_ZERO_ADDRESS) === 0n).to.be.true;
      });

      it('U11 entity-id 0.0.1011 is a regex miss and returns real balance', async () => {
        restMock.onGet(accountsUrl('0.0.1011')).reply(
          200,
          JSON.stringify({
            account: '0.0.1011',
            balance: { balance: DEF_BALANCE },
          }),
        );

        const resBalance = await ethImpl.getBalance('0.0.1011', 'latest', requestDetails);
        expect(resBalance).to.equal(DEF_HEX_BALANCE);
        expect(constants.LONG_ZERO_ADDRESS_REGEX.test('0.0.1011')).to.be.false;
      });

      it('U12 checksum 0x…052C is suppressed and the mirror URL uses the raw input', async () => {
        restMock
          .onGet(accountsUrl(LONG_ZERO_ENTRYPOINT_ADDRESS))
          .reply(200, JSON.stringify(MOCK_ACCOUNT_ENTRYPOINT_TWIN));

        const resBalance = await ethImpl.getBalance(LONG_ZERO_ENTRYPOINT_ADDRESS, 'latest', requestDetails);
        expect(resBalance).to.equal(constants.ZERO_HEX);
        expect(accountRequestUrls().some((url) => url.includes(LONG_ZERO_ENTRYPOINT_ADDRESS))).to.be.true;
      });

      it('U14 numeric latest-0/1/2 tags suppress without balances?account.id=', async () => {
        restMock.onGet(accountsUrl(LONG_ZERO_TWIN_ADDRESS)).reply(200, JSON.stringify(MOCK_ACCOUNT_TWIN));
        restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
        restMock.onGet('blocks/9999').reply(
          200,
          JSON.stringify({
            number: 9999,
            timestamp: {
              from: `${Number(BLOCK_TIMESTAMP) - 2000}.060890919`,
              to: `${Number(BLOCK_TIMESTAMP) - 2000}.060890949`,
            },
          }),
        );
        restMock.onGet('blocks/9998').reply(
          200,
          JSON.stringify({
            number: 9998,
            timestamp: {
              from: `${Number(BLOCK_TIMESTAMP) - 2000}.060890919`,
              to: `${Number(BLOCK_TIMESTAMP) - 2000}.060890949`,
            },
          }),
        );

        for (const tag of ['0x2710', '0x270f', '0x270e']) {
          restMock.resetHistory();
          const resBalance = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, tag, requestDetails);
          expect(resBalance).to.equal(constants.ZERO_HEX);
          expect(balancesRequestUrls()).to.be.empty;
        }
      });

      it('U15 evm_address without 0x still suppresses', async () => {
        const before = await decisionCount('suppressed');
        restMock.onGet(accountsUrl(LONG_ZERO_TWIN_ADDRESS)).reply(
          200,
          JSON.stringify({
            account: '0.0.1083',
            balance: { balance: DEF_BALANCE },
            evm_address: '5d5d82b6042e2be8c00526d7167582ea2b324498',
          }),
        );

        const resBalance = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, 'latest', requestDetails);
        expect(resBalance).to.equal(constants.ZERO_HEX);
        expect(await decisionCount('suppressed')).to.equal(before + 1);
      });

      it('U17 ua_class labels mint / onyx-ops / canary / other', async () => {
        restMock.onGet(accountsUrl(LONG_ZERO_TWIN_ADDRESS)).reply(200, JSON.stringify(MOCK_ACCOUNT_TWIN));

        const cases: Array<{ ua?: string; label: string }> = [
          { ua: 'mint/1.9.3', label: 'mint' },
          { ua: 'onyx-ops', label: 'onyx-ops' },
          { ua: constants.LONG_ZERO_TWIN_CANARY_UA, label: 'canary' },
          { ua: 'curl/8.0', label: 'other' },
          { ua: undefined, label: 'other' },
        ];

        for (const { ua, label } of cases) {
          const before = await decisionCount('suppressed', label);
          const details = new RequestDetails({
            requestId: `eth_getBalanceTest-${label}`,
            ipAddress: '0.0.0.0',
            userAgent: ua,
          });
          restMock.resetHistory();
          const resBalance = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, 'latest', details);
          expect(resBalance).to.equal(constants.ZERO_HEX);
          expect(await decisionCount('suppressed', label)).to.be.greaterThan(before);
        }
      });
    });

    describe('U13 observe + default + invalid', () => {
      it('config default is off', () => {
        expect(ConfigService.get('LONG_ZERO_TWIN_POLICY')).to.equal('off');
      });

      describe('observe', () => {
        overrideEnvsInMochaDescribe({ LONG_ZERO_TWIN_POLICY: 'observe' });

        it('twin returns real balance and increments would_suppress', async () => {
          const before = await decisionCount('would_suppress');
          restMock.onGet(accountsUrl(LONG_ZERO_TWIN_ADDRESS)).reply(200, JSON.stringify(MOCK_ACCOUNT_TWIN));

          const resBalance = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, 'latest', requestDetails);
          expect(resBalance).to.equal(DEF_HEX_BALANCE);
          expect(await decisionCount('would_suppress')).to.equal(before + 1);
        });
      });

      describe('invalid flag', () => {
        overrideEnvsInMochaDescribe({ LONG_ZERO_TWIN_POLICY: 'not-a-mode' });

        it('treats invalid as off: real balance and no extra probe', async () => {
          restMock.onGet(accountsUrl(LONG_ZERO_TWIN_ADDRESS)).reply(200, JSON.stringify(MOCK_ACCOUNT_TWIN));

          const resBalance = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, 'latest', requestDetails);
          expect(resBalance).to.equal(DEF_HEX_BALANCE);
          expect(accountRequestUrls()).to.have.lengthOf(1);
        });
      });
    });

    describe('U16 cache skip for long-zero in every mode', () => {
      it('off then balance recomputes; long-zero is never cached; canonical still caches', async () => {
        ConfigServiceTestHelper.dynamicOverride('LONG_ZERO_TWIN_POLICY', 'off');
        restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
        restMock.onGet(accountsUrl(LONG_ZERO_TWIN_ADDRESS)).reply(200, JSON.stringify(MOCK_ACCOUNT_TWIN));
        restMock.onGet(accountsUrl(ACCOUNT_ADDRESS_1)).reply(200, JSON.stringify(MOCK_BALANCE_RES));

        const first = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, '0x2710', requestDetails);
        expect(first).to.equal(DEF_HEX_BALANCE);

        const longZeroKeys = (await cacheService.keys('*043b*', 'getBalance')).concat(
          await cacheService.keys('*043B*', 'getBalance'),
        );
        expect(longZeroKeys).to.be.empty;
        expect(await cacheService.getAsync(`getBalance_${LONG_ZERO_TWIN_ADDRESS}_0x2710`, 'getBalance')).to.be.oneOf([
          null,
          undefined,
        ]);

        ConfigServiceTestHelper.dynamicOverride('LONG_ZERO_TWIN_POLICY', 'balance');
        const second = await ethImpl.getBalance(LONG_ZERO_TWIN_ADDRESS, '0x2710', requestDetails);
        expect(second).to.equal(constants.ZERO_HEX);
        const longZeroKeysAfter = (await cacheService.keys('*043b*', 'getBalance')).concat(
          await cacheService.keys('*043B*', 'getBalance'),
        );
        expect(longZeroKeysAfter).to.be.empty;

        const canonical = await ethImpl.getBalance(ACCOUNT_ADDRESS_1, '0x2710', requestDetails);
        expect(canonical).to.equal(DEF_HEX_BALANCE);
        restMock.resetHandlers();
        restMock.onGet(BLOCKS_LIMIT_ORDER_URL).reply(200, JSON.stringify(MOCK_BLOCKS_FOR_BALANCE_RES));
        const cachedCanonical = await ethImpl.getBalance(ACCOUNT_ADDRESS_1, '0x2710', requestDetails);
        expect(cachedCanonical).to.equal(DEF_HEX_BALANCE);

        ConfigServiceTestHelper.dynamicOverride('LONG_ZERO_TWIN_POLICY', 'off');
      });
    });
  });
});
