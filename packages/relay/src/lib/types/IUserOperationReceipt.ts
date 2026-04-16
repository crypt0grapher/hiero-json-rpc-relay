// SPDX-License-Identifier: Apache-2.0

import type { Log } from '../model';
import type { ITransactionReceipt } from './ITransactionReceipt';

export interface IUserOperationReceipt {
  actualGasCost: string;
  actualGasUsed: string;
  entryPoint: string;
  logs: Log[];
  nonce: string;
  paymaster: string;
  receipt: ITransactionReceipt;
  reason?: string;
  sender: string;
  success: boolean;
  userOpHash: string;
}
