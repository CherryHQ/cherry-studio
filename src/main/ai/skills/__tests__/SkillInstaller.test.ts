import * as path from 'node:path'

import { SKILL_DIRECTORY_CONTENT_HASH_PREFIX } from '@shared/utils/skillMarketplace'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPathExists = vi.fn()
const mockCopyDirectoryRecursive = vi.fn()
const mockDeleteDirectoryRecursive = vi.fn()
const mockFsRename = vi.fn()
const mockFsLstat = vi.fn()
const mockFsReaddir = vi.fn()
const mockFsReadFile = vi.fn()
const mockFindSkillMdPath = vi.fn()

vi.mock('@main/utils/legacyFile', () => ({
  pathExists: (...args: unknown[]) => mockPathExists(...args)
}))

vi.mock('@main/utils/fileOperations', () => ({
  copyDirectoryRecursive: (...args: unknown[]) => mockCopyDirectoryRecursive(...args),
  deleteDirectoryRecursive: (...args: unknown[]) => mockDeleteDirectoryRecursive(...args)
}))

vi.mock('fs', () => ({
  promises: {
    rename: (...args: unknown[]) => mockFsRename(...args),
    lstat: (...args: unknown[]) => mockFsLstat(...args),
    readdir: (...args: unknown[]) => mockFsReaddir(...args),
    readFile: (...args: unknown[]) => mockFsReadFile(...args)
  }
}))

vi.mock('@main/utils/markdownParser', () => ({
  findSkillMdPath: (...args: unknown[]) => mockFindSkillMdPath(...args)
}))

const { SkillInstaller } = await import('../SkillInstaller')

describe('SkillInstaller', () => {
  let installer: InstanceType<typeof SkillInstaller>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFsLstat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    mockFindSkillMdPath.mockResolvedValue('/global-skills/my-skill/SKILL.md')
    mockFsReadFile.mockResolvedValue('# skill')
    installer = new SkillInstaller()
  })

  describe('install', () => {
    beforeEach(() => {
      vi.spyOn(installer, 'computeDirectoryHash').mockResolvedValue('same-hash')
    })

    it('should skip copy when source and destination resolve to the same path', async () => {
      await installer.install('/global-skills/my-skill', '/global-skills/my-skill')

      expect(mockPathExists).not.toHaveBeenCalled()
      expect(mockCopyDirectoryRecursive).not.toHaveBeenCalled()
      expect(mockFsRename).not.toHaveBeenCalled()
    })

    it('should copy when source and destination are different', async () => {
      mockPathExists.mockResolvedValue(false)
      mockCopyDirectoryRecursive.mockResolvedValue(undefined)

      await installer.install('/tmp/my-skill', '/global-skills/my-skill')

      expect(mockCopyDirectoryRecursive).toHaveBeenCalledWith('/tmp/my-skill', '/global-skills/my-skill')
    })

    it('commits a verified replacement before deleting the old skill', async () => {
      mockPathExists.mockResolvedValue(true)
      mockCopyDirectoryRecursive.mockResolvedValue(undefined)
      mockFsRename.mockResolvedValue(undefined)
      mockDeleteDirectoryRecursive.mockResolvedValue(undefined)

      await installer.install('/tmp/my-skill', '/global-skills/my-skill')

      expect(mockFsRename).toHaveBeenNthCalledWith(1, '/global-skills/my-skill', '/global-skills/.my-skill.bak')
      expect(mockFsRename).toHaveBeenNthCalledWith(
        2,
        '/global-skills/.my-skill.bak',
        '/global-skills/.my-skill.cleanup'
      )
      expect(mockDeleteDirectoryRecursive).toHaveBeenCalledWith('/global-skills/.my-skill.cleanup')
    })

    it('keeps the verified replacement when committed-backup cleanup is interrupted', async () => {
      mockPathExists.mockResolvedValue(true)
      mockCopyDirectoryRecursive.mockResolvedValue(undefined)
      mockFsRename.mockResolvedValue(undefined)
      mockDeleteDirectoryRecursive.mockRejectedValue(new Error('cleanup interrupted'))

      await expect(installer.install('/tmp/my-skill', '/global-skills/my-skill')).resolves.toBeUndefined()

      expect(mockFsRename).toHaveBeenCalledTimes(2)
      expect(mockFsRename).not.toHaveBeenCalledWith('/global-skills/.my-skill.bak', '/global-skills/my-skill')
      expect(mockDeleteDirectoryRecursive).not.toHaveBeenCalledWith('/global-skills/my-skill')
    })

    it('keeps the original skill when moving it to the backup path fails', async () => {
      mockPathExists.mockResolvedValue(true)
      mockFsRename.mockRejectedValue(new Error('rename failed'))

      await expect(installer.install('/tmp/my-skill', '/global-skills/my-skill')).rejects.toThrow('rename failed')

      expect(mockCopyDirectoryRecursive).not.toHaveBeenCalled()
      expect(mockDeleteDirectoryRecursive).not.toHaveBeenCalled()
    })

    it('restores the previous skill when the copied destination is incomplete', async () => {
      mockPathExists.mockResolvedValue(true)
      mockCopyDirectoryRecursive.mockResolvedValue(undefined)
      mockFsRename.mockResolvedValue(undefined)
      vi.mocked(installer.computeDirectoryHash)
        .mockResolvedValueOnce('source-hash')
        .mockRejectedValueOnce(new Error('SKILL.md not found'))

      await expect(installer.install('/tmp/my-skill', '/global-skills/my-skill')).rejects.toThrow('SKILL.md not found')

      expect(mockDeleteDirectoryRecursive).toHaveBeenCalledWith('/global-skills/my-skill')
      expect(mockFsRename).toHaveBeenNthCalledWith(2, '/global-skills/.my-skill.bak', '/global-skills/my-skill')
    })

    it('restores the previous skill when the copied descriptor differs from the source', async () => {
      mockPathExists.mockResolvedValue(true)
      mockCopyDirectoryRecursive.mockResolvedValue(undefined)
      mockFsRename.mockResolvedValue(undefined)
      vi.mocked(installer.computeDirectoryHash)
        .mockResolvedValueOnce('source-hash')
        .mockResolvedValueOnce('corrupted-hash')

      await expect(installer.install('/tmp/my-skill', '/global-skills/my-skill')).rejects.toThrow(
        'Installed skill content did not match the source'
      )

      expect(mockDeleteDirectoryRecursive).toHaveBeenCalledWith('/global-skills/my-skill')
      expect(mockFsRename).toHaveBeenNthCalledWith(2, '/global-skills/.my-skill.bak', '/global-skills/my-skill')
    })
  })

  it('uses a versioned full-directory hash as the persisted content baseline', async () => {
    mockFsReaddir.mockImplementation(async (directory: string) => {
      if (directory.endsWith('/scripts')) {
        return [{ name: 'run.sh' }]
      }
      return [{ name: 'SKILL.md' }, { name: 'scripts' }]
    })
    mockFsLstat.mockImplementation(async (entryPath: string) => ({
      isSymbolicLink: () => false,
      isDirectory: () => entryPath.endsWith('/scripts'),
      isFile: () => !entryPath.endsWith('/scripts')
    }))
    mockFsReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('/SKILL.md')) return Buffer.from('# same descriptor')
      return Buffer.from(filePath.startsWith('/source/') ? 'complete script' : 'truncated script')
    })
    mockFindSkillMdPath.mockImplementation(async (directory: string) => path.join(directory, 'SKILL.md'))

    const sourceHash = await installer.computeContentHash('/source/skill')
    const installedHash = await installer.computeContentHash('/installed/skill')

    expect(sourceHash).toMatch(new RegExp(`^${SKILL_DIRECTORY_CONTENT_HASH_PREFIX}[a-f0-9]{64}$`))
    expect(installedHash).not.toBe(sourceHash)
  })

  it('recovers every hidden backup before reconciliation can prune the catalog', async () => {
    mockFsReaddir.mockResolvedValue([
      { name: '.first.bak', isDirectory: () => true },
      { name: 'ordinary', isDirectory: () => true }
    ])
    mockFsLstat.mockResolvedValue({ isDirectory: () => true })
    mockPathExists.mockResolvedValue(false)
    mockFsRename.mockResolvedValue(undefined)

    await installer.recoverInterruptedInstalls('/global-skills')

    expect(mockFsRename).toHaveBeenCalledWith('/global-skills/.first.bak', '/global-skills/first')
  })

  it('cleans a committed backup without replacing the installed skill', async () => {
    mockFsReaddir.mockResolvedValue([
      { name: '.first.cleanup', isDirectory: () => true },
      { name: 'first', isDirectory: () => true }
    ])
    mockDeleteDirectoryRecursive.mockResolvedValue(undefined)

    await installer.recoverInterruptedInstalls('/global-skills')

    expect(mockDeleteDirectoryRecursive).toHaveBeenCalledWith('/global-skills/.first.cleanup')
    expect(mockFsRename).not.toHaveBeenCalled()
  })
})
