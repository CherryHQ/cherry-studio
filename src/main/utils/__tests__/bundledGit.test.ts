import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getBundledGitDir, getBundledGitPath } from '../bundledGit'

// Force the Windows code path regardless of host so both branches run everywhere.
vi.mock('@main/core/platform', () => ({ isWin: true }))
vi.mock('fs')
vi.mock('path')
// getBundledGit* resolve application.getPath() + toAsarUnpackedPath; mock both so
// the test controls the candidate path and asserts only the existence check.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
vi.mock('../asar', () => ({ toAsarUnpackedPath: (p: string) => p }))

describe('bundledGit', () => {
  const platformKey = `${process.platform}-${process.arch}`
  const expectedExe = ['/mock/app.root.resources.binaries', platformKey, 'git', 'cmd', 'git.exe'].join('\\')
  const expectedDir = ['/mock/app.root.resources.binaries', platformKey, 'git', 'cmd'].join('\\')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(path.join).mockImplementation((...args) => args.join('\\'))
    vi.mocked(path.dirname).mockImplementation((p) => p.split('\\').slice(0, -1).join('\\'))
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
