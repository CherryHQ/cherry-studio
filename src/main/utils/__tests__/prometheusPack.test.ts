import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installPrometheusPack, PACK_ENTRIES } from '../prometheusPack'

/**
 * These tests use a REAL temp filesystem rather than a mocked `node:fs`. What is under test
 * is filesystem behaviour — that a tree is copied, that a stale file is replaced, that nothing
 * escapes the destination. Asserting those against a mock would assert that the mock was
 * called, which is the vacuous-pass defect this repo has been bitten by before.
 */

let sourceRoot: string
let runtimeRoot: string

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('../asar', () => ({
  toAsarUnpackedPath: vi.fn((filePath: string) => filePath)
}))

const { mockGetPath } = vi.hoisted(() => ({ mockGetPath: vi.fn() }))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

/** Builds a miniature pack: the three directories the doctor needs, plus a stray one it does not. */
async function writeSourcePack(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true })
  await fs.writeFile(path.join(root, 'scripts', 'doctor.mjs'), 'export const version = 1\n')
  await fs.mkdir(path.join(root, 'lib', 'doctor'), { recursive: true })
  await fs.writeFile(path.join(root, 'lib', 'doctor', 'registry.mjs'), 'export const checks = []\n')
  await fs.mkdir(path.join(root, 'rules'), { recursive: true })
  await fs.writeFile(path.join(root, 'rules', 'build.conf'), 'x\n')
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"prometheus-skills-mini"}\n')
  // Present in the submodule, deliberately NOT part of the runnable pack.
  await fs.mkdir(path.join(root, 'openspec'), { recursive: true })
  await fs.writeFile(path.join(root, 'openspec', 'config.yaml'), 'y\n')
}

beforeEach(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pack-test-'))
  sourceRoot = path.join(base, 'source')
  runtimeRoot = path.join(base, 'runtime')
  await writeSourcePack(sourceRoot)

  const { application } = await import('@application')
  mockGetPath.mockImplementation((key: string) => {
    if (key === 'feature.prometheus.pack.builtin') return sourceRoot
    if (key === 'feature.prometheus.pack.runtime') return runtimeRoot
    return `/mock/${key}`
  })
  vi.mocked(application.getPath).mockImplementation(mockGetPath as never)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('installPrometheusPack', () => {
  it('copies every runnable entry into the runtime root', async () => {
    await installPrometheusPack()

    // The gate for prometheus-003: the doctor must be spawnable from here.
    await expect(fs.access(path.join(runtimeRoot, 'scripts', 'doctor.mjs'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(runtimeRoot, 'lib', 'doctor', 'registry.mjs'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(runtimeRoot, 'rules', 'build.conf'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(runtimeRoot, 'package.json'))).resolves.toBeUndefined()
  })

  it('copies only the runnable entries, not the whole submodule', async () => {
    await installPrometheusPack()

    // `openspec/` is 100+ files of specs that nothing at runtime reads. Copying the whole
    // submodule on every launch would be slow and would ship spec churn into userData.
    await expect(fs.access(path.join(runtimeRoot, 'openspec'))).rejects.toThrow()
    expect(PACK_ENTRIES).not.toContain('openspec')
  })

  it('replaces a stale file from a previous app version', async () => {
    await fs.mkdir(path.join(runtimeRoot, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(runtimeRoot, 'scripts', 'doctor.mjs'), 'STALE\n')

    await installPrometheusPack()

    const content = await fs.readFile(path.join(runtimeRoot, 'scripts', 'doctor.mjs'), 'utf8')
    expect(content).toBe('export const version = 1\n')
  })

  it('removes a file the pack no longer ships', async () => {
    await fs.mkdir(path.join(runtimeRoot, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(runtimeRoot, 'scripts', 'removed-upstream.mjs'), 'old\n')

    await installPrometheusPack()

    // Otherwise a script deleted upstream keeps running from userData forever.
    await expect(fs.access(path.join(runtimeRoot, 'scripts', 'removed-upstream.mjs'))).rejects.toThrow()
  })

  it('is idempotent across repeated launches', async () => {
    await installPrometheusPack()
    await installPrometheusPack()

    const entries = await fs.readdir(path.join(runtimeRoot, 'scripts'))
    expect(entries).toEqual(['doctor.mjs'])
  })

  it('does not throw when the submodule is not checked out', async () => {
    await fs.rm(sourceRoot, { recursive: true, force: true })

    // A missing submodule must degrade, never block the launch.
    await expect(installPrometheusPack()).resolves.toBeUndefined()
  })

  it('never follows a symlink out of the source tree', async () => {
    const outside = path.join(path.dirname(sourceRoot), 'outside-secret.txt')
    await fs.writeFile(outside, 'SECRET\n')
    await fs.symlink(outside, path.join(sourceRoot, 'scripts', 'escape.mjs'))

    await installPrometheusPack()

    // The copy must not materialise content from outside the pack root.
    const copied = path.join(runtimeRoot, 'scripts', 'escape.mjs')
    await expect(fs.readFile(copied, 'utf8')).rejects.toThrow()
  })
})
