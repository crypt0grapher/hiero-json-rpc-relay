// SPDX-License-Identifier: Apache-2.0

/**
 * A lightweight LRU-style cache that maps transaction hashes to their block
 * numbers.  Populated during `getBlock()` (blockWorker) so that downstream
 * consumers such as `getTransactionReceipt()` can resolve "phantom"
 * transactions -- hashes that appear in block responses (from
 * `populateSyntheticTransactions()`) but have no individual contract-result
 * or log entry in the mirror node.
 *
 * The cache lives in-process (not Redis) because it is only useful for the
 * short window between a client calling `eth_getBlockByNumber` and the
 * subsequent `eth_getTransactionReceipt` for one of the block's hashes.
 *
 * Configuration (env vars):
 *   TX_BLOCK_CACHE_MAX_SIZE  – maximum number of entries (default 200 000)
 *   TX_BLOCK_CACHE_TTL_MS    – per-entry time-to-live in ms (default 1 h)
 */

interface CacheEntry {
  blockNumber: string;
  expiry: number;
}

class TransactionBlockCache {
  private readonly cache: Map<string, CacheEntry>;
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize?: number, ttlMs?: number) {
    this.maxSize = maxSize ?? (Number(process.env.TX_BLOCK_CACHE_MAX_SIZE) || 200_000);
    this.ttlMs = ttlMs ?? (Number(process.env.TX_BLOCK_CACHE_TTL_MS) || 3_600_000);
    this.cache = new Map();
  }

  /**
   * Store the mapping from a transaction hash to its block number.
   * If the cache exceeds `maxSize`, the oldest entries (by insertion order)
   * are evicted.
   */
  set(hash: string, blockNumber: string): void {
    // Delete first so re-insertion moves the key to the end (most-recent)
    this.cache.delete(hash);
    this.cache.set(hash, {
      blockNumber,
      expiry: Date.now() + this.ttlMs,
    });

    // Evict oldest entries when over capacity
    if (this.cache.size > this.maxSize) {
      const excess = this.cache.size - this.maxSize;
      const iter = this.cache.keys();
      for (let i = 0; i < excess; i++) {
        const oldest = iter.next().value;
        if (oldest !== undefined) {
          this.cache.delete(oldest);
        }
      }
    }
  }

  /**
   * Return the cached block number for a given transaction hash, or `null`
   * if the hash is not present or has expired.
   */
  get(hash: string): string | null {
    const entry = this.cache.get(hash);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.cache.delete(hash);
      return null;
    }

    return entry.blockNumber;
  }

  /** Current number of (possibly stale) entries. */
  get size(): number {
    return this.cache.size;
  }

  /** Remove all entries. */
  clear(): void {
    this.cache.clear();
  }
}

/** Singleton instance shared across modules within the same V8 isolate. */
export const transactionBlockCache = new TransactionBlockCache();

/** Export the class for unit-testing with custom parameters. */
export { TransactionBlockCache };
