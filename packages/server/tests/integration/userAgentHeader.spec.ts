// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { readUserAgentHeader } from '../../src/koaJsonRpc/lib/userAgent';

describe('readUserAgentHeader', () => {
  it('returns the user-agent string for a single request header', () => {
    expect(readUserAgentHeader({ 'user-agent': 'mint/1.9.3' })).to.equal('mint/1.9.3');
  });

  it('returns the first value when the header is an array (batch-style)', () => {
    expect(readUserAgentHeader({ 'user-agent': ['onyx-ops', 'other'] })).to.equal('onyx-ops');
  });

  it('returns undefined when the header is missing or empty', () => {
    expect(readUserAgentHeader(undefined)).to.equal(undefined);
    expect(readUserAgentHeader({})).to.equal(undefined);
    expect(readUserAgentHeader({ 'user-agent': '' })).to.equal(undefined);
    expect(readUserAgentHeader({ 'user-agent': [] })).to.equal(undefined);
  });
});
