import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  application: { getPath: vi.fn(() => '') },
  cleanupOtherArtifactVersions: vi.fn<() => Promise<void>>(async () => undefined),
  ensureBundledTree: vi.fn(),
  packaged: true,
  readBundledArtifactManifestAt: vi.fn(),
  resolveDshRuntimeArtifact: vi.fn(() => ({
    manifestPath: '/resources/dsh-runtime/manifest.json',
    archiveRoot: '/resources/dsh-runtime'
  }))
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.packaged
    }
  }
}))

vi.mock('@application', () => ({ application: mocks.application }))
vi.mock('@cherrystudio/dsh-bridge', () => ({ resolveDshRuntimeArtifact: mocks.resolveDshRuntimeArtifact }))
vi.mock('@main/services/bundledArtifact', () => ({
  cleanupOtherArtifactVersions: mocks.cleanupOtherArtifactVersions,
  ensureBundledTree: mocks.ensureBundledTree
}))
vi.mock('@main/utils/bundledArtifactManifest', () => ({
  bundledArtifactPlatformKey: (platform = 'linux', arch = 'x64') => `${platform}-${arch}`,
  readBundledArtifactManifestAt: mocks.readBundledArtifactManifestAt
}))

const artifact = {
  kind: 'tree' as const,
  version: 'runtime-v1',
  compression: 'zstd' as const,
  archive: 'dsh-runtime.tar.zst',
  archiveSha256: 'a'.repeat(64),
  sha256: 'b'.repeat(64),
  size: 10,
  entrypoints: ['bin/entry.js'],
  files: [{ path: 'bin/entry.js', sha256: 'c'.repeat(64), size: 10, mode: 0o644 }]
}

const manifest = {
  schemaVersion: 2 as const,
  platform: 'linux',
  arch: 'x64',
  artifacts: { 'dsh-runtime': artifact }
}

async function loadDshRuntime() {
  vi.resetModules()
  return import('../dshRuntime')
}

function makeRuntimeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-cache-'))
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(root, 'bin', 'entry.js'), 'runtime\n')
  return root
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.packaged = true
  mocks.application.getPath.mockReturnValue('/toolchain/dsh-runtime')
  mocks.readBundledArtifactManifestAt.mockReturnValue(manifest)
})

describe('ensureDshRuntime', () => {
  it('coalesces concurrent extraction and cleans old versions after validation', async () => {
    const root = makeRuntimeRoot()
    const module = await loadDshRuntime()
    mocks.ensureBundledTree.mockResolvedValue({ status: 'installed', root })

    const [first, second] = await Promise.all([module.ensureDshRuntime(), module.ensureDshRuntime()])

    expect(first).toBe(root)
    expect(second).toBe(root)
    expect(mocks.ensureBundledTree).toHaveBeenCalledOnce()
    expect(mocks.resolveDshRuntimeArtifact).toHaveBeenCalledOnce()
    expect(mocks.readBundledArtifactManifestAt).toHaveBeenCalledWith('/resources/dsh-runtime/manifest.json')
    expect(mocks.ensureBundledTree).toHaveBeenCalledWith(
      manifest,
      artifact,
      '/toolchain/dsh-runtime/runtime-v1/linux-x64',
      { archiveRoot: '/resources/dsh-runtime' }
    )
    expect(mocks.cleanupOtherArtifactVersions).toHaveBeenCalledWith('/toolchain/dsh-runtime', 'runtime-v1')

    await expect(module.ensureDshRuntime()).resolves.toBe(root)
    expect(mocks.ensureBundledTree).toHaveBeenCalledTimes(2)
    expect(mocks.resolveDshRuntimeArtifact).toHaveBeenCalledTimes(2)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('clears a failed installation so the next session can retry', async () => {
    const root = makeRuntimeRoot()
    const module = await loadDshRuntime()
    mocks.ensureBundledTree.mockRejectedValueOnce(new Error('archive checksum mismatch'))

    await expect(module.ensureDshRuntime()).rejects.toThrow('archive checksum mismatch')
    expect(mocks.cleanupOtherArtifactVersions).not.toHaveBeenCalled()

    mocks.ensureBundledTree.mockResolvedValueOnce({ status: 'ready', root })
    await expect(module.ensureDshRuntime()).resolves.toBe(root)
    expect(mocks.ensureBundledTree).toHaveBeenCalledTimes(2)
    expect(mocks.cleanupOtherArtifactVersions).toHaveBeenCalledOnce()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('rejects a cache that does not contain every declared entrypoint', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-incomplete-'))
    const module = await loadDshRuntime()
    mocks.ensureBundledTree.mockResolvedValue({ status: 'installed', root })

    await expect(module.ensureDshRuntime()).rejects.toThrow(/entrypoint is not a file/)
    expect(mocks.cleanupOtherArtifactVersions).not.toHaveBeenCalled()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('does not touch packaged artifacts in development mode', async () => {
    mocks.packaged = false
    const module = await loadDshRuntime()

    await expect(module.ensureDshRuntime()).resolves.toBeUndefined()
    expect(mocks.readBundledArtifactManifestAt).not.toHaveBeenCalled()
    expect(mocks.ensureBundledTree).not.toHaveBeenCalled()
  })
})
