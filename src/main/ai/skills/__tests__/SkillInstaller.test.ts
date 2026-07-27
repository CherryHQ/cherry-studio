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

    it('restores the previous skill when the copied destination is incomplete', async () => {
      mockPathExists.mockResolvedValue(true)
      mockCopyDirectoryRecursive.mockResolvedValue(undefined)
      mockFsRename.mockResolvedValue(undefined)
      mockFindSkillMdPath.mockResolvedValueOnce('/tmp/my-skill/SKILL.md').mockResolvedValueOnce(null)

      await expect(installer.install('/tmp/my-skill', '/global-skills/my-skill')).rejects.toThrow('SKILL.md not found')

      expect(mockDeleteDirectoryRecursive).toHaveBeenCalledWith('/global-skills/my-skill')
      expect(mockFsRename).toHaveBeenNthCalledWith(2, '/global-skills/.my-skill.bak', '/global-skills/my-skill')
    })

    it('restores the previous skill when the copied descriptor differs from the source', async () => {
      mockPathExists.mockResolvedValue(true)
      mockCopyDirectoryRecursive.mockResolvedValue(undefined)
      mockFsRename.mockResolvedValue(undefined)
      mockFsReadFile.mockResolvedValueOnce('# source').mockResolvedValueOnce('# corrupted')

      await expect(installer.install('/tmp/my-skill', '/global-skills/my-skill')).rejects.toThrow(
        'Installed skill content did not match the source'
      )

      expect(mockDeleteDirectoryRecursive).toHaveBeenCalledWith('/global-skills/my-skill')
      expect(mockFsRename).toHaveBeenNthCalledWith(2, '/global-skills/.my-skill.bak', '/global-skills/my-skill')
    })
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
})
