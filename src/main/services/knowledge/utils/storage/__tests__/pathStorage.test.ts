// Path-safety tests for the knowledge "store by relative path" core. The reject
// branches of `assertSafeKnowledgeRelativePath` / `isPathInsideBase` are the
// security boundary for every copied source file, so they are exercised here
// through the exported helpers (the guards themselves are private).
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { copyMock, ensureDirMock, removeMock, removeDirMock, lstatMock } = vi.hoisted(() => ({
  copyMock: vi.fn(),
  ensureDirMock: vi.fn(),
  removeMock: vi.fn(),
  removeDirMock: vi.fn(),
  lstatMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('node:fs/promises', () => ({
  default: { lstat: lstatMock }
}))

vi.mock('@main/utils/file/fs', () => ({
  copy: copyMock,
  ensureDir: ensureDirMock,
  remove: removeMock,
  removeDir: removeDirMock
}))

const {
  getKnowledgeBaseDir,
  getKnowledgeBaseFilePath,
  getKnowledgeSourceRelativePath,
  toKnowledgeRelativePath,
  getProcessedMarkdownRelativePath,
  copyFileIntoKnowledgeBaseAt
} = await import('../pathStorage')

const BASE_ID = 'kb-1'
const BASE_DIR = getKnowledgeBaseDir(BASE_ID)

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error('missing'), { code: 'ENOENT' })
}

describe('pathStorage relative-path safety', () => {
  describe('getKnowledgeBaseFilePath', () => {
    it.each([
      ['parent traversal', '../escape.md'],
      ['nested parent traversal', 'a/../../escape.md'],
      ['POSIX absolute path', '/etc/passwd'],
      ['empty string', ''],
      ['current dir', '.'],
      ['parent dir', '..'],
      ['null byte', 'a\0b']
    ])('rejects %s', (_label, relativePath) => {
      expect(() => getKnowledgeBaseFilePath(BASE_ID, relativePath)).toThrow('Invalid knowledge relative path')
    })

    it.each([
      ['the reserved meta dir', '.cherry'],
      ['a path under the reserved meta dir', '.cherry/index.sqlite']
    ])('rejects %s', (_label, relativePath) => {
      expect(() => getKnowledgeBaseFilePath(BASE_ID, relativePath)).toThrow('Knowledge relative path is reserved')
    })

    it('accepts a safe nested relative path', () => {
      expect(getKnowledgeBaseFilePath(BASE_ID, 'sub/dir/file.md')).toBe(path.join(BASE_DIR, 'sub/dir/file.md'))
    })
  })

  describe('getKnowledgeSourceRelativePath', () => {
    it('reduces a source path to its basename', () => {
      expect(getKnowledgeSourceRelativePath('/some/dir/report.pdf')).toBe('report.pdf')
    })
  })

  describe('toKnowledgeRelativePath', () => {
    it('returns a POSIX relative path for a path inside the base', () => {
      expect(toKnowledgeRelativePath(BASE_ID, path.join(BASE_DIR, 'a', 'b.md'))).toBe('a/b.md')
    })

    it.each([
      ['an unrelated absolute path', '/etc/passwd'],
      ['a sibling base', path.join(path.dirname(BASE_DIR), 'kb-2', 'x.md')]
    ])('rejects %s', (_label, absolutePath) => {
      expect(() => toKnowledgeRelativePath(BASE_ID, absolutePath)).toThrow()
    })
  })

  describe('getProcessedMarkdownRelativePath', () => {
    it('swaps the extension to .md while keeping directories', () => {
      expect(getProcessedMarkdownRelativePath('sub/report.pdf')).toBe('sub/report.md')
    })

    it('rejects an unsafe relative path', () => {
      expect(() => getProcessedMarkdownRelativePath('../x.pdf')).toThrow('Invalid knowledge relative path')
    })
  })

  describe('copyFileIntoKnowledgeBaseAt', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      lstatMock.mockRejectedValue(enoent())
      ensureDirMock.mockResolvedValue(undefined)
      copyMock.mockResolvedValue(undefined)
    })

    it('rejects an unsafe target relative path before any filesystem write', async () => {
      await expect(copyFileIntoKnowledgeBaseAt(BASE_ID, '/src/a.md', '../escape.md')).rejects.toThrow(
        'Invalid knowledge relative path'
      )
      expect(copyMock).not.toHaveBeenCalled()
    })

    it('creates parent directories and copies for a nested target', async () => {
      const relativePath = 'docs/sub/a.md'
      await expect(copyFileIntoKnowledgeBaseAt(BASE_ID, '/src/a.md', relativePath)).resolves.toBe(relativePath)
      const destPath = path.join(BASE_DIR, relativePath)
      expect(ensureDirMock).toHaveBeenCalledWith(path.dirname(destPath))
      expect(copyMock).toHaveBeenCalledWith('/src/a.md', destPath)
    })

    it('throws when the target already exists', async () => {
      lstatMock.mockResolvedValueOnce({})
      await expect(copyFileIntoKnowledgeBaseAt(BASE_ID, '/src/a.md', 'a.md')).rejects.toThrow(
        'Knowledge file already exists'
      )
      expect(copyMock).not.toHaveBeenCalled()
    })
  })
})
