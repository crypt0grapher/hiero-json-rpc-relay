// SPDX-License-Identifier: Apache-2.0

import { RLP } from '@ethereumjs/rlp';
import { bytesToInt, concatBytes, hexToBytes, intToBytes } from '@ethereumjs/util';

import { ASCIIToHex, isHex, nanOrNumberTo0x, numberTo0x, prepend0x, toHash32, toHexString } from '../../formatters';
import { LogsBloomUtils } from '../../logsBloomUtils';
import constants from '../constants';
import { Log } from '../model';
import { ITransactionReceipt } from '../types';
import { IReceiptRlpInput } from '../types/IReceiptRlpInput';

/**
 * Parameters specific to creating a synthetic transaction receipt from logs
 */
interface ISyntheticTransactionReceiptParams {
  syntheticLogs: Log[];
  gasPriceForTimestamp: string;
}

/**
 * Parameters specific to creating a regular transaction receipt from mirror node data
 */
interface IRegularTransactionReceiptParams {
  effectiveGas: string;
  from: string;
  logs: Log[];
  receiptResponse: any;
  to: string | null;
  cumulativeGasUsed: number;
}

/**
 * Factory for creating different types of transaction receipts
 */
class TransactionReceiptFactory {
  /**
   * Creates a synthetic transaction receipt from a log
   *
   * @param params Parameters required to create a synthetic transaction receipt
   * @returns {ITransactionReceipt} Transaction receipt for the synthetic transaction
   */
  public static createSyntheticReceipt(params: ISyntheticTransactionReceiptParams): ITransactionReceipt {
    const { syntheticLogs, gasPriceForTimestamp } = params;

    return {
      blockHash: syntheticLogs[0].blockHash,
      blockNumber: syntheticLogs[0].blockNumber,
      contractAddress: syntheticLogs[0].address,
      cumulativeGasUsed: constants.ZERO_HEX,
      effectiveGasPrice: gasPriceForTimestamp,
      from: constants.ZERO_ADDRESS_HEX,
      gasUsed: constants.ZERO_HEX,
      logs: syntheticLogs,
      logsBloom: LogsBloomUtils.buildLogsBloom(syntheticLogs),
      root: constants.DEFAULT_ROOT_HASH,
      status: constants.ONE_HEX,
      to: syntheticLogs[0].address,
      transactionHash: syntheticLogs[0].transactionHash,
      transactionIndex: syntheticLogs[0].transactionIndex,
      type: constants.ZERO_HEX, // fallback to 0x0 from HAPI transactions
    };
  }

  /**
   * Creates a regular transaction receipt from mirror node contract result data
   *
   * Handles the correction of transaction receipt `to` field for contract creation transactions.
   *
   * This logic addresses a discrepancy between Hedera and standard Ethereum behavior regarding
   * the `to` field in transaction receipts. When a smart contract is deployed:
   *
   * 1. In standard Ethereum JSON-RPC, if the original transaction had a null `to` field
   *    (contract creation), the transaction receipt also reports a null `to` field.
   *
   * 2. Hedera Mirror Node, however, automatically populates the `to` field with the
   *    address of the newly created contract.
   *
   * The code checks if a contract was directly created by the transaction (rather than created by
   * another contract) by checking if the contract's ID appears in the `created_contract_ids` array.
   * If so, it resets the `to` field to null to match standard Ethereum JSON-RPC behavior.
   *
   * This ensures compatibility with Ethereum tooling that expects standard transaction receipt formats.
   * The handling covers various scenarios:
   *
   * - Direct contract deployment (empty `to` field)
   * - Contract creation via factory contracts
   * - Method calls that don't create contracts
   * - Transactions with populated `to` fields that create child contracts
   *
   * @param params Parameters required to create a regular transaction receipt
   * @param resolveEvmAddressFn Function to resolve EVM addresses
   * @returns {ITransactionReceipt} Transaction receipt for the regular transaction
   */
  public static createRegularReceipt(params: IRegularTransactionReceiptParams): ITransactionReceipt {
    const { receiptResponse, effectiveGas, from, logs, cumulativeGasUsed } = params;
    let { to } = params;

    // Determine contract address if it exists
    const contractAddress = TransactionReceiptFactory.getContractAddressFromReceipt(receiptResponse);

    // Per Ethereum spec: if a contract was created, `to` must be null in the receipt.
    // contractAddress is non-null only for actual creation transactions (direct deploy,
    // factory-self-creation, or HTS precompile), so it's sufficient to null `to` here.
    if (contractAddress !== null) {
      to = null;
    }

    // Create the receipt object
    const receipt: ITransactionReceipt = {
      blockHash: toHash32(receiptResponse.block_hash),
      blockNumber: numberTo0x(receiptResponse.block_number),
      from: from,
      to: to,
      cumulativeGasUsed: cumulativeGasUsed ? numberTo0x(cumulativeGasUsed) : constants.ZERO_HEX,
      gasUsed: nanOrNumberTo0x(receiptResponse.gas_used),
      contractAddress: contractAddress,
      logs: logs,
      logsBloom: receiptResponse.bloom === constants.EMPTY_HEX ? constants.EMPTY_BLOOM : receiptResponse.bloom,
      transactionHash: toHash32(receiptResponse.hash),
      transactionIndex: numberTo0x(receiptResponse.transaction_index),
      effectiveGasPrice: effectiveGas,
      root: receiptResponse.root || constants.DEFAULT_ROOT_HASH,
      status: receiptResponse.status,
      type: nanOrNumberTo0x(receiptResponse.type),
    };

    // Add revert reason if available
    if (receiptResponse.error_message) {
      receipt.revertReason = isHex(prepend0x(receiptResponse.error_message))
        ? receiptResponse.error_message
        : prepend0x(ASCIIToHex(receiptResponse.error_message));
    }

    return receipt;
  }

  /**
   * Helper method to determine if a receipt response includes a contract address.
   *
   * Per Ethereum spec, `contractAddress` is set ONLY when the transaction creates a contract.
   * For regular contract calls, it must be `null`.
   *
   * On Hedera, `created_contract_ids` only lists child contracts created during execution,
   * NOT the top-level contract for direct deployments (ContractCreate / EthereumTransaction).
   * To detect direct deployments, we check if the function_parameters contains EVM init code
   * rather than a function call (init code starts with known patterns like PUSH1 0x80 PUSH1 0x40).
   *
   * @param receiptResponse Mirror node contract result response
   * @returns {string | null} Contract address if created, null otherwise
   */
  private static getContractAddressFromReceipt(receiptResponse: any): string | null {
    // 1. Check if contract was created via HTS system contract precompile
    const isCreationViaSystemContract = constants.HTS_CREATE_FUNCTIONS_SELECTORS.includes(
      receiptResponse.function_parameters.substring(0, constants.FUNCTION_SELECTOR_CHAR_LENGTH),
    );

    if (isCreationViaSystemContract) {
      // Handle system contract creation
      // reason for substring is described in the design doc in this repo: docs/design/hts_address_tx_receipt.md
      const tokenAddress = receiptResponse.call_result.substring(receiptResponse.call_result.length - 40);
      return prepend0x(tokenAddress);
    }

    // 2. Check if this transaction itself created the contract (contract_id is in created_contract_ids).
    //    On Hedera, created_contract_ids lists child contracts spawned during execution.
    //    When the transaction's own contract_id appears in that list, the tx IS the creation.
    if (receiptResponse.created_contract_ids?.includes(receiptResponse.contract_id)) {
      return receiptResponse.address;
    }

    // 3. Detect direct contract deployment via EthereumTransaction.
    //    On Hedera, direct deployments (ContractCreate / EthereumTransaction with init code)
    //    do NOT populate created_contract_ids with the top-level contract.
    //    We detect these by checking if function_parameters contains EVM init code.
    //    Init code is typically >100 bytes and starts with standard Solidity memory setup
    //    opcodes (PUSH1 0x80 PUSH1 0x40 MSTORE = 0x6080604052).
    const fp = receiptResponse.function_parameters || '';
    const fpHex = fp.startsWith('0x') ? fp.substring(2) : fp;
    const fpByteLen = fpHex.length / 2;

    if (fpByteLen > 100) {
      const fpPrefix = fpHex.substring(0, 10); // first 5 bytes
      const initCodePrefixes = ['6080604052', '6060604052', '60a0604052', '60c0604052'];
      if (initCodePrefixes.some((p) => fpPrefix.startsWith(p))) {
        return receiptResponse.address;
      }
    }

    // Default: not a contract creation — return null per Ethereum spec
    return null;
  }

  /**
   * Encodes a single transaction receipt to EIP-2718 binary form.
   *
   * Produces the RLP-encoded 4-tuple (receipt_root_or_status, cumulative_gas_used,
   * logs_bloom, logs) per the Ethereum Yellow Paper. For typed transactions (type !== 0),
   * the output is the single-byte type prefix followed by that RLP payload (EIP-2718).
   *
   * Based on section 4.4.1 (Transaction Receipt) from the Ethereum Yellow Paper: https://ethereum.github.io/yellowpaper/paper.pdf
   *
   * @param receipt - The transaction receipt to encode (see {@link ITransactionReceipt}).
   * @returns Hex string (0x-prefixed) of the encoded receipt, suitable for receipts root hashing.
   */
  public static encodeReceiptToHex(receipt: IReceiptRlpInput): string {
    const txType = receipt.type !== null ? bytesToInt(hexToBytes(receipt.type)) : 0;

    // First field: receipt root or status (post-Byzantium)
    let receiptRootOrStatus: Uint8Array;
    if (receipt.root && receipt.root.length > 2) {
      receiptRootOrStatus = hexToBytes(receipt.root);
    } else if (receipt.status && bytesToInt(hexToBytes(receipt.status)) === 0) {
      receiptRootOrStatus = new Uint8Array(0);
    } else {
      receiptRootOrStatus = hexToBytes(constants.ONE_HEX);
    }

    const cumulativeGasUsed = receipt.cumulativeGasUsed;
    const cumulativeGasUsedBytes =
      BigInt(cumulativeGasUsed) === BigInt(0)
        ? new Uint8Array(0)
        : hexToBytes(prepend0x(BigInt(cumulativeGasUsed).toString(16))); // canonical RLP encoding (no leading zeros)

    const receiptLogsParam = receipt.logs.map((log) => [
      hexToBytes(log.address),
      log.topics.map((t) => hexToBytes(t)),
      hexToBytes(log.data),
    ]);

    const encodedList = RLP.encode([
      receiptRootOrStatus,
      cumulativeGasUsedBytes,
      hexToBytes(receipt.logsBloom),
      receiptLogsParam,
    ]);

    if (txType === 0) {
      return prepend0x(toHexString(encodedList));
    }
    const withPrefix = concatBytes(intToBytes(txType), encodedList);
    return prepend0x(toHexString(withPrefix));
  }
}

export { ISyntheticTransactionReceiptParams, IRegularTransactionReceiptParams, TransactionReceiptFactory };
