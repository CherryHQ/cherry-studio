import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getBundledGitDir, getBundledGitPath } from '../bundledGit'

// Force the Windows code path regardless of host so both branches run everywhere.
vi.mock('@main/core/platform', () => ({ isWin: true }))
vi.mock('fs')
// getBundledGit* resolve the centralized Toolchain path; mock it so the test
// controls the candidate path and asserts only the existence check.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('../bundledArtifactManifest', () => ({
  bundledArtifactPlatformKey: (platform: string, arch: string) => `${platform}-${arch}`,
  readBundledArtifactManifest: () => ({
    schemaVersion: 1,
    platform: 'win32',
    arch: 'x64',
    artifacts: {
      mingit: {
        kind: 'tree',
        version: '2.54.0',
        archive: 'mingit.tar.zst',
        archiveSha256: 'a'.repeat(64),
        sha256: 'b'.repeat(64),
        size: 100,
        entrypoints: ['git/cmd/git.exe']
      }
    }
  })
}))

describe('bundledGit', () => {
  const expectedExe = path.join('/mock/feature.binary.mingit', '2.54.0', 'win32-x64', 'git', 'cmd', 'git.exe')
  const expectedDir = path.dirname(expectedExe)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getBundledGitPath', () => {
    it('returns the bundled MinGit path when git.exe exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedExe)

      expect(getBundledGitPath()).toBe(expectedExe)
    })

    it('returns null when the bundled git.exe is absent', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(getBundledGitPath()).toBeNull()
    })
  })

  describe('getBundledGitDir', () => {
    it('returns the git cmd dir when git.exe exists', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedExe)

      expect(getBundledGitDir()).toBe(expectedDir)
    })

    it('returns null when the bundled git.exe is absent', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(getBundledGitDir()).toBeNull()
    })
  })
})
