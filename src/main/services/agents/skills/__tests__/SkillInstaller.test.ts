import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPathExists = vi.fn()
const mockCopyDirectoryRecursive = vi.fn()
const mockDeleteDirectoryRecursive = vi.fn()
const mockFsRename = vi.fn()

vi.mock('@main/utils/file', () => ({
  pathExists: (...args: unknown[]) => mockPathExists(...args)
}))

vi.mock('@main/utils/fileOperations', () => ({
  copyDirectoryRecursive: (...args: unknown[]) => mockCopyDirectoryRecursive(...args),
  deleteDirectoryRecursive: (...args: unknown[]) => mockDeleteDirectoryRecursive(...args)
}))

vi.mock('fs', () => ({
  promises: {
    rename: (...args: unknown[]) => mockFsRename(...args)
  }
}))

vi.mock('@main/utils/markdownParser', () => ({
  findSkillMdPath: vi.fn()
}))

const { SkillInstaller } = await import('../SkillInstaller')

describe('SkillInstaller', () => {
  let installer: InstanceType<typeof SkillInstaller>

  beforeEach(() => {
    vi.clearAllMocks()
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
  })
})
