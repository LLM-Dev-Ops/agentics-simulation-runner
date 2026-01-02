/**
 * SHA256 Hashing and Canonical JSON Serialization
 *
 * Provides deterministic hashing utilities for plan integrity verification
 * and execution fingerprint computation.
 *
 * @module src/utils/hash
 * @see SPARC_REFINEMENT.md Section 2.5 - Canonical Ordering Rules
 * @see SPARC_REFINEMENT.md Section 3.4 - Execution Fingerprint Computation
 */

import { createHash } from 'crypto';

/**
 * Type alias for SHA256 hash output
 */
export type SHA256Hash = string;

/**
 * Canonical ordering rules from Refinement 2.5:
 * - Maps/Dictionaries: lexicographic key order (UTF-8)
 * - Sets: lexicographic element order
 * - Arrays: preserve insertion order
 * - JSON Objects: keys sorted lexicographically
 * - Database Results: explicit ORDER BY required (handled at query level)
 */

/**
 * Canonicalize an object to a deterministic JSON string
 *
 * Ensures that the same logical object always produces the same string
 * representation, regardless of property insertion order.
 *
 * Ordering rules:
 * - Object keys: sorted lexicographically (UTF-8)
 * - Arrays: preserved in original order
 * - Primitives: standard JSON representation
 * - Undefined values: omitted
 * - null: preserved
 * - BigInt: converted to string representation
 * - Date: converted to ISO 8601 string
 * - Map: converted to sorted object
 * - Set: converted to sorted array
 *
 * @param obj - The object to canonicalize
 * @returns Deterministic JSON string
 *
 * @example
 * ```typescript
 * // Same result regardless of property order
 * canonicalize({ b: 1, a: 2 }) === canonicalize({ a: 2, b: 1 })
 * // => '{"a":2,"b":1}'
 * ```
 */
export function canonicalize(obj: unknown): string {
  return JSON.stringify(obj, replacer, 0);
}

/**
 * Custom replacer function for canonical JSON serialization
 */
function replacer(key: string, value: unknown): unknown {
  // Handle null first
  if (value === null) {
    return null;
  }

  // Handle undefined - will be omitted by JSON.stringify
  if (value === undefined) {
    return undefined;
  }

  // Handle BigInt - convert to string
  if (typeof value === 'bigint') {
    return value.toString();
  }

  // Handle Date - convert to ISO string
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Handle Map - convert to sorted object
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    const sortedKeys = Array.from(value.keys()).sort((a, b) =>
      String(a).localeCompare(String(b), 'en', { sensitivity: 'variant' })
    );
    for (const k of sortedKeys) {
      obj[String(k)] = value.get(k);
    }
    return obj;
  }

  // Handle Set - convert to sorted array
  if (value instanceof Set) {
    return Array.from(value).sort((a, b) =>
      String(a).localeCompare(String(b), 'en', { sensitivity: 'variant' })
    );
  }

  // Handle regular objects - sort keys
  if (typeof value === 'object' && !Array.isArray(value)) {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(value as object).sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'variant' })
    );
    for (const k of keys) {
      sortedObj[k] = (value as Record<string, unknown>)[k];
    }
    return sortedObj;
  }

  // Arrays and primitives remain unchanged
  return value;
}

/**
 * Compute SHA256 hash of any data
 *
 * The data is first canonicalized to ensure deterministic hashing
 * regardless of object property order.
 *
 * @param data - Any JSON-serializable data
 * @returns SHA256 hash as lowercase hexadecimal string
 *
 * @example
 * ```typescript
 * const hash = computeSHA256({ planId: 'abc', version: '1.0' });
 * // => 'a3f2b1c4d5e6f7...'
 * ```
 *
 * @see SPARC_REFINEMENT.md Section 3.4 - FUNCTION computeExecutionFingerprint
 */
export function computeSHA256(data: unknown): SHA256Hash {
  const canonical = canonicalize(data);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Compute SHA256 hash of raw string or Buffer
 *
 * Use this when you need to hash data that's already in its final form
 * and should not be canonicalized.
 *
 * @param data - Raw string or Buffer to hash
 * @returns SHA256 hash as lowercase hexadecimal string
 */
export function computeSHA256Raw(data: string | Buffer): SHA256Hash {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute SHA256 hash of multiple items concatenated
 *
 * Used for computing execution fingerprints where multiple hashes
 * need to be combined deterministically.
 *
 * @param items - Array of items to hash together
 * @returns SHA256 hash of concatenated canonical representations
 *
 * @see SPARC_REFINEMENT.md Section 3.4 - fingerprintData composition
 */
export function computeSHA256Combined(...items: unknown[]): SHA256Hash {
  const hash = createHash('sha256');
  for (const item of items) {
    hash.update(canonicalize(item), 'utf8');
  }
  return hash.digest('hex');
}

/**
 * Verify that a hash matches the expected value
 *
 * @param data - The data to verify
 * @param expectedHash - The expected SHA256 hash
 * @returns true if the hash matches, false otherwise
 */
export function verifySHA256(data: unknown, expectedHash: SHA256Hash): boolean {
  const computedHash = computeSHA256(data);
  // Use timing-safe comparison to prevent timing attacks
  if (computedHash.length !== expectedHash.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Compute hash for execution fingerprint
 *
 * Implements the fingerprint algorithm from SPARC_REFINEMENT.md Section 3.4
 *
 * @param fingerprint - Fingerprint data object
 * @returns SHA256 hash of the fingerprint
 */
export interface ExecutionFingerprintData {
  version: string;
  planHash: SHA256Hash;
  seed: string | number;
  snapshotHashes: SHA256Hash[];
  randomnessHashes: SHA256Hash[];
}

export function computeExecutionFingerprint(
  fingerprint: ExecutionFingerprintData
): SHA256Hash {
  // Ensure snapshot hashes are sorted for determinism
  const sortedSnapshotHashes = [...fingerprint.snapshotHashes].sort();

  // Randomness hashes should maintain order (sequence dependent)
  const fingerprintData = {
    version: fingerprint.version,
    planHash: fingerprint.planHash,
    seed: String(fingerprint.seed),
    snapshotHashes: sortedSnapshotHashes,
    randomnessHashes: fingerprint.randomnessHashes,
  };

  return computeSHA256(fingerprintData);
}

/**
 * Compute hash for a randomness log entry
 *
 * @see SPARC_REFINEMENT.md Section 3.4 - randomnessHashes computation
 */
export function computeRandomnessEntryHash(
  sequenceNum: number,
  operation: string,
  randomValue: bigint | string
): SHA256Hash {
  const entryData = {
    sequenceNum,
    operation,
    randomValue: String(randomValue),
  };
  return computeSHA256(entryData);
}
