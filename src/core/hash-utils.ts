/**
 * Hash Utilities for Content-Addressable Identifiers
 *
 * Implements:
 * - INV-IN-003: SimulationPlan MUST have valid planHash
 * - INV-OUT-003: SimulationResult MUST have valid resultHash
 * - GUA-REP-004: Execution fingerprint is verifiable
 *
 * References:
 * - SPARC_SPECIFICATION.md Section 3.1.2, 4.1.2
 * - SPARC_PSEUDOCODE.md Section 7.3 generateReproducibilityProof
 */

import CryptoJS from 'crypto-js';
import { MerkleTree } from 'merkletreejs';
import type { SHA256Hash } from '../types/common.js';

/**
 * Compute SHA256 hash of data
 */
export function computeSHA256(data: string | Uint8Array): SHA256Hash {
  if (data instanceof Uint8Array) {
    const wordArray = CryptoJS.lib.WordArray.create(data as unknown as number[]);
    return CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
  }
  return CryptoJS.SHA256(data).toString(CryptoJS.enc.Hex);
}

/**
 * Compute hash of an object by canonicalizing it first
 * Objects are sorted by keys recursively for deterministic output
 */
export function computeObjectHash(obj: unknown): SHA256Hash {
  const canonical = canonicalize(obj);
  return computeSHA256(canonical);
}

/**
 * Canonicalize an object to a deterministic JSON string
 * Keys are sorted alphabetically at all levels
 */
export function canonicalize(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Sort object keys
      return Object.keys(value)
        .sort()
        .reduce<Record<string, unknown>>((sorted, key) => {
          sorted[key] = value[key];
          return sorted;
        }, {});
    }
    // Handle BigInt serialization
    if (typeof value === 'bigint') {
      return value.toString() + 'n';
    }
    return value;
  });
}

/**
 * Verify a hash matches the expected value
 */
export function verifyHash(data: string | Uint8Array, expectedHash: SHA256Hash): boolean {
  const computedHash = computeSHA256(data);
  return computedHash.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Verify an object's hash
 */
export function verifyObjectHash(obj: unknown, expectedHash: SHA256Hash): boolean {
  const computedHash = computeObjectHash(obj);
  return computedHash.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Create a Merkle tree from a list of data items
 * Used for efficient verification of large datasets
 */
export function createMerkleTree(items: string[]): MerkleTree {
  const leaves = items.map((item) => computeSHA256(item));
  return new MerkleTree(leaves, (data: Buffer) => {
    return Buffer.from(computeSHA256(new Uint8Array(data)), 'hex');
  });
}

/**
 * Get Merkle root hash
 */
export function getMerkleRoot(tree: MerkleTree): SHA256Hash {
  return tree.getRoot().toString('hex');
}

/**
 * Get Merkle proof for an item
 */
export function getMerkleProof(tree: MerkleTree, item: string): string[] {
  const leaf = computeSHA256(item);
  return tree.getProof(Buffer.from(leaf, 'hex')).map((p) => p.data.toString('hex'));
}

/**
 * Verify a Merkle proof
 */
export function verifyMerkleProof(
  tree: MerkleTree,
  item: string,
  proof: string[],
  root: SHA256Hash
): boolean {
  const leaf = Buffer.from(computeSHA256(item), 'hex');
  const proofBuffers = proof.map((p) => ({
    data: Buffer.from(p, 'hex'),
    position: 'right' as const,
  }));
  return tree.verify(proofBuffers, leaf, Buffer.from(root, 'hex'));
}

/**
 * Compute execution fingerprint from execution data
 * Implements GUA-REP-004: Execution fingerprint is verifiable
 */
export function computeExecutionFingerprint(data: {
  planHash: SHA256Hash;
  deterministicSeed: bigint;
  snapshotHashes: SHA256Hash[];
  randomnessEntries: Array<{
    sequence: number;
    operation: string;
    valueHash: SHA256Hash;
  }>;
}): SHA256Hash {
  const fingerprintData = {
    planHash: data.planHash,
    deterministicSeed: data.deterministicSeed.toString(),
    snapshotHashes: data.snapshotHashes,
    randomnessEntries: data.randomnessEntries,
  };
  return computeObjectHash(fingerprintData);
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
