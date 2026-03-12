// SPDX-License-Identifier: Apache-2.0

export class HbarSpendingPlanNotFoundError extends Error {
  constructor(id: string) {
    super(`XCN spending plan with ID ${id} not found`);
    this.name = 'HbarSpendingPlanNotFoundError';
  }
}

export class HbarSpendingPlanNotActiveError extends Error {
  constructor(id: string) {
    super(`XCN spending plan with ID ${id} is not active`);
    this.name = 'HbarSpendingPlanNotActiveError';
  }
}

export class EvmAddressHbarSpendingPlanNotFoundError extends Error {
  constructor(evmAddress: string) {
    super(`EVM address XCN spending plan with address ${evmAddress} not found`);
    this.name = 'EvmAddressHbarSpendingPlanNotFoundError';
  }
}

export class IPAddressHbarSpendingPlanNotFoundError extends Error {
  constructor(ipAddress: string) {
    super(`IP address XCN spending plan not found`);
    this.name = 'IPAddressHbarSpendingPlanNotFoundError';
  }
}
