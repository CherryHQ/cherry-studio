import type * as BundledArtifactManifestModule from '@main/utils/bundledArtifactManifest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cleanupOtherArtifactVersions: vi.fn<() => Promise<void>>(async () => undefined),
  ensureBundledFiles: vi.fn(),
  packaged: true,
  readBundledArtifactManifest: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.packaged
    }
  }
}))

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn(() => '/toolchain/claude-agent-sdk')
  }
}))

vi.mock('@main/core/platform', () => ({ isLinux: false, isWin: false }))

vi.mock('@main/services/bundledArtifact', () => ({
  cleanupOtherArtifactVersions: mocks.cleanupOtherArtifactVersions,
  ensureBundledFiles: mocks.ensureBundledFiles
}))

vi.mock('@main/utils/bundledArtifactManifest', async (importOriginal) => ({
  ...(await importOriginal<typeof BundledArtifactManifestModule>()),
  readBundledArtifactManifest: mocks.readBundledArtifactManifest
}))

vi.mock('@main/utils/asar', () => ({ toAsarUnpackedPath: (value: string) => value }))

import { ClaudeCodeBinaryService, resolveInstalledClaudeExecutablePath } from '../ClaudeCodeBinaryService'

const manifest = {
  schemaVersion: 2 as const,
  platform: 'darwin',
  arch: 'arm64',
  artifacts: {
    claude: {
      kind: 'files' as const,
      version: '0.3.220',
      files: [
        {
          output: 'claude',
          archive: 'claude.zst',
          compression: 'zstd',
          archiveSha256: 'a'.repeat(64),
          sha256: 'b'.repeat(64),
          size: 100,
          mode: 0o755
        }
      ]
    }
  }
}

describe('ClaudeCodeBinaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.packaged = true
    mocks.readBundledArtifactManifest.mockReturnValue(manifest)
    mocks.ensureBundledFiles.mockResolvedValue({
      status: 'installed',
      paths: new Map([['claude', '/toolchain/claude-agent-sdk/0.3.220/darwin-arm64/claude']])
    })
    mocks.cleanupOtherArtifactVersions.mockResolvedValue(undefined)
  })

  it('coalesces concurrent first-use extraction into one task', async () => {
    let release: ((result: { status: 'installed'; paths: Map<string, string> }) => void) | undefined
    mocks.ensureBundledFiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const service = new ClaudeCodeBinaryService()

    const first = service.ensureExecutable()
    const second = service.ensureExecutable()
    await vi.waitFor(() => expect(mocks.ensureBundledFiles).toHaveBeenCalledOnce())
    release?.({
      status: 'installed',
      paths: new Map([['claude', '/toolchain/claude-agent-sdk/0.3.220/darwin-arm64/claude']])
    })

    const expected = '/toolchain/claude-agent-sdk/0.3.220/darwin-arm64/claude'
    await expect(Promise.all([first, second])).resolves.toEqual([expected, expected])
    expect(mocks.cleanupOtherArtifactVersions).toHaveBeenCalledWith('/toolchain/claude-agent-sdk', '0.3.220')
  })

  it('reuses a fully verified version cache without extracting it again', async () => {
    mocks.ensureBundledFiles.mockResolvedValue({
      status: 'ready',
      paths: new Map([['claude', '/toolchain/claude-agent-sdk/0.3.220/darwin-arm64/claude']])
    })
    const service = new ClaudeCodeBinaryService()

    await expect(service.ensureExecutable()).resolves.toBe('/toolchain/claude-agent-sdk/0.3.220/darwin-arm64/claude')

    expect(mocks.ensureBundledFiles).toHaveBeenCalledOnce()
    expect(mocks.cleanupOtherArtifactVersions).toHaveBeenCalledOnce()
  })

  it('does not clean old versions when current-version installation fails and permits a retry', async () => {
    mocks.ensureBundledFiles.mockRejectedValueOnce(new Error('payload checksum mismatch'))
    const service = new ClaudeCodeBinaryService()

    await expect(service.ensureExecutable()).rejects.toThrow('payload checksum mismatch')
    expect(mocks.cleanupOtherArtifactVersions).not.toHaveBeenCalled()

    await expect(service.ensureExecutable()).resolves.toContain('/0.3.220/darwin-arm64/claude')
    expect(mocks.ensureBundledFiles).toHaveBeenCalledTimes(2)
    expect(mocks.cleanupOtherArtifactVersions).toHaveBeenCalledOnce()
  })

  it('fails clearly when the packaged Claude payload is absent', async () => {
    mocks.readBundledArtifactManifest.mockReturnValue({ ...manifest, artifacts: {} })
    const service = new ClaudeCodeBinaryService()

    await expect(service.ensureExecutable()).rejects.toThrow(/payload missing for/)
    expect(mocks.ensureBundledFiles).not.toHaveBeenCalled()
  })

  it('resolves the installed native package directly in development', () => {
    mocks.packaged = false

    expect(resolveInstalledClaudeExecutablePath()).toMatch(/claude-agent-sdk-.+[\\/]claude(?:\.exe)?$/)
  })
})
