/**
 * ADR-0001 Verification 1, 2, 5 — source-level guarantees.
 *
 * These assert on the source tree itself because the property being protected
 * is "this code cannot come back", not a runtime behaviour.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src');

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return collectSourceFiles(full);
    }
    return full.endsWith('.ts') ? [full] : [];
  });
}

const SOURCE_FILES = collectSourceFiles(SRC_DIR);
const SERVER_SOURCE = readFileSync(join(SRC_DIR, 'server.ts'), 'utf-8');

describe('Verification 1 — the empty execute block is gone', () => {
  it('server.ts contains no try block whose body is only comments', () => {
    const commentOnlyTry = /try\s*\{(?:\s*\/\/[^\n]*\n)+\s*\}/;
    expect(commentOnlyTry.test(SERVER_SOURCE)).toBe(false);
  });

  it('server.ts contains no empty try block at all', () => {
    expect(/try\s*\{\s*\}/.test(SERVER_SOURCE)).toBe(false);
  });
});

describe('Verification 2 — no fabricated telemetry', () => {
  it('no array literal is ever assigned to layersExecuted', () => {
    const offenders = SOURCE_FILES.filter((file) =>
      /layersExecuted\s*:\s*\[/.test(readFileSync(file, 'utf-8'))
    );
    expect(offenders).toEqual([]);
  });

  it('fanout is not reachable from the deprecated flat handler', () => {
    const handler = SERVER_SOURCE.slice(
      SERVER_SOURCE.indexOf('async function handleSimulationRunner'),
      SERVER_SOURCE.indexOf('async function handleRequest')
    );
    expect(handler.length).toBeGreaterThan(0);
    expect(handler).not.toContain('fireFanout');
  });

  it('no fanout failure is silently swallowed', () => {
    expect(SERVER_SOURCE).not.toContain('swallow');
    expect(/fireFanout\([^)]*\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/.test(SERVER_SOURCE)).toBe(false);
  });
});

describe('Verification 4 and 5 — no mock defaults or hardcoded credentials in src/', () => {
  it('no source file defaults to a mock with ?? new Mock', () => {
    const offenders = SOURCE_FILES.filter((file) =>
      /\?\?\s*new\s+Mock/.test(readFileSync(file, 'utf-8'))
    );
    expect(offenders).toEqual([]);
  });

  it('no source file contains the hardcoded mock credentials', () => {
    const offenders = SOURCE_FILES.filter((file) => {
      const content = readFileSync(file, 'utf-8');
      return content.includes('mock-api-key-12345') || content.includes('mock-bearer-token-67890');
    });
    expect(offenders).toEqual([]);
  });

  it('no source file synthesises a credential from its reference', () => {
    const offenders = SOURCE_FILES.filter((file) =>
      readFileSync(file, 'utf-8').includes('mock-resolved-')
    );
    expect(offenders).toEqual([]);
  });

  it('createMockSecureVault is imported only by tests', () => {
    const offenders = SOURCE_FILES.filter(
      (file) =>
        !file.endsWith('connection-establisher.ts') &&
        readFileSync(file, 'utf-8').includes('createMockSecureVault')
    );
    expect(offenders).toEqual([]);
  });
});

describe('Verification 6 — the real factory is wired', () => {
  it('agent-resolver reaches the real client factory in surfaces/', () => {
    const resolver = readFileSync(join(SRC_DIR, 'orchestration/agent-resolver.ts'), 'utf-8');
    expect(resolver).toContain("from './provider-llm-client-factory.js'");
    expect(resolver).toContain('new ProviderLLMClientFactory()');

    const factory = readFileSync(
      join(SRC_DIR, 'orchestration/provider-llm-client-factory.ts'),
      'utf-8'
    );
    expect(factory).toContain("from '../surfaces/llm-client-factory.js'");
  });

  it('MockLLMClient no longer exists anywhere in src/', () => {
    const offenders = SOURCE_FILES.filter((file) =>
      readFileSync(file, 'utf-8').includes('MockLLMClient')
    );
    expect(offenders).toEqual([]);
  });
});
