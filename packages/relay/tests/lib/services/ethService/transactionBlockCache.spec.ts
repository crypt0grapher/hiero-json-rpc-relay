// SPDX-License-Identifier: Apache-2.0

import { expect } from 'chai';

import { TransactionBlockCache } from '../../../../src/lib/services/ethService/transactionBlockCache';

describe('@transactionBlockCache TransactionBlockCache tests', function () {
  describe('set and get', function () {
    it('should store and retrieve a block number for a transaction hash', function () {
      const cache = new TransactionBlockCache(100, 60_000);
      cache.set('0xabc123', '0x10');
      expect(cache.get('0xabc123')).to.equal('0x10');
    });

    it('should return null for a hash that was never stored', function () {
      const cache = new TransactionBlockCache(100, 60_000);
      expect(cache.get('0xnotfound')).to.be.null;
    });

    it('should overwrite an existing entry when set is called again', function () {
      const cache = new TransactionBlockCache(100, 60_000);
      cache.set('0xabc123', '0x10');
      cache.set('0xabc123', '0x20');
      expect(cache.get('0xabc123')).to.equal('0x20');
    });

    it('should track the size correctly', function () {
      const cache = new TransactionBlockCache(100, 60_000);
      expect(cache.size).to.equal(0);
      cache.set('0xa', '0x1');
      expect(cache.size).to.equal(1);
      cache.set('0xb', '0x2');
      expect(cache.size).to.equal(2);
      // Overwrite does not increase size
      cache.set('0xa', '0x3');
      expect(cache.size).to.equal(2);
    });
  });

  describe('TTL expiry', function () {
    it('should return null for an expired entry', function () {
      // TTL of 1ms -- entry expires almost instantly
      const cache = new TransactionBlockCache(100, 1);
      cache.set('0xexpired', '0x5');

      // Force a small delay to ensure expiry
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy-wait 5ms
      }

      expect(cache.get('0xexpired')).to.be.null;
    });

    it('should remove expired entries from the map on access', function () {
      const cache = new TransactionBlockCache(100, 1);
      cache.set('0xexpired', '0x5');

      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy-wait
      }

      // Access triggers eviction
      cache.get('0xexpired');
      expect(cache.size).to.equal(0);
    });

    it('should return the value when TTL has not yet expired', function () {
      const cache = new TransactionBlockCache(100, 60_000);
      cache.set('0xvalid', '0xaa');
      expect(cache.get('0xvalid')).to.equal('0xaa');
    });
  });

  describe('max size eviction', function () {
    it('should evict the oldest entries when maxSize is exceeded', function () {
      const cache = new TransactionBlockCache(3, 60_000);
      cache.set('0x1', '0xa');
      cache.set('0x2', '0xb');
      cache.set('0x3', '0xc');
      expect(cache.size).to.equal(3);

      // Adding a 4th entry should evict the oldest (0x1)
      cache.set('0x4', '0xd');
      expect(cache.size).to.equal(3);
      expect(cache.get('0x1')).to.be.null; // evicted
      expect(cache.get('0x2')).to.equal('0xb');
      expect(cache.get('0x3')).to.equal('0xc');
      expect(cache.get('0x4')).to.equal('0xd');
    });

    it('should evict multiple entries when multiple are added at once', function () {
      const cache = new TransactionBlockCache(2, 60_000);
      cache.set('0x1', '0xa');
      cache.set('0x2', '0xb');
      cache.set('0x3', '0xc');
      cache.set('0x4', '0xd');
      expect(cache.size).to.equal(2);
      expect(cache.get('0x1')).to.be.null;
      expect(cache.get('0x2')).to.be.null;
      expect(cache.get('0x3')).to.equal('0xc');
      expect(cache.get('0x4')).to.equal('0xd');
    });

    it('should re-insert an existing key without exceeding maxSize', function () {
      const cache = new TransactionBlockCache(3, 60_000);
      cache.set('0x1', '0xa');
      cache.set('0x2', '0xb');
      cache.set('0x3', '0xc');

      // Re-insert 0x1 -- moves to end, no eviction needed
      cache.set('0x1', '0xz');
      expect(cache.size).to.equal(3);
      expect(cache.get('0x1')).to.equal('0xz');
      expect(cache.get('0x2')).to.equal('0xb');
      expect(cache.get('0x3')).to.equal('0xc');
    });
  });

  describe('clear', function () {
    it('should remove all entries', function () {
      const cache = new TransactionBlockCache(100, 60_000);
      cache.set('0x1', '0xa');
      cache.set('0x2', '0xb');
      expect(cache.size).to.equal(2);

      cache.clear();
      expect(cache.size).to.equal(0);
      expect(cache.get('0x1')).to.be.null;
      expect(cache.get('0x2')).to.be.null;
    });
  });
});
