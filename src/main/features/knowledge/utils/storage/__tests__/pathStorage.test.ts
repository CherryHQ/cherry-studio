// Path-safety tests for the knowledge "store by relative path" core. The reject
// branches of `assertSafeKnowledgeRelativePath` / `isPathInsideBase` are the
// security boundary for every copied source file, so they are exercised here
// through the exported helpers (the guards themselves are private).
import path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { copyMock, writeMock, ensureDirMock, removeMock, removeDirMock, rmdirMock, lstatMock, errorMock, warnMock } =
  vi.hoisted(() => ({
    copyMock: vi.fn(),
    writeMock: vi.fn(),
    ensureDirMock: vi.fn(),
    removeMock: vi.fn(),
    removeDirMock: vi.fn(),
    rmdirMock: vi.fn(),
    lstatMock: vi.fn(),
    errorMock: vi.fn(),
    warnMock: vi.fn()
  }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: errorMock, info: vi.fn(), warn: warnMock })
  }
}))

vi.mock('node:fs/promises', () => ({
  default: { lstat: lstatMock, rmdir: rmdirMock }
}))

vi.mock('@main/utils/file/fs', () => ({
  copy: copyMock,
  write: writeMock,
  ensureDir: ensureDirMock,
  remove: removeMock,
  removeDir: removeDirMock
}))

const {
  getKnowledgeBaseDir,
  getKnowledgeMaterialDir,
  getKnowledgeBaseFilePath,
  getKnowledgeSourceRelativePath,
  toKnowledgeRelativePath,
  getProcessedMarkdownRelativePath,
  reserveImportedFileRelativePath,
  needsProcessedArtifactReservation,
  copyFileIntoKnowledgeBaseAt,
  writeFileIntoKnowledgeBaseAt,
  collectKnowledgeReservedRelativePaths,
  deleteKnowledgeItemFiles,
  deleteKnowledgeItemFilesBestEffort
} = await import('../pathStorage')

const BASE_ID = 'kb-1'
const BASE_DIR = getKnowledgeBaseDir(BASE_ID)
// Material bytes resolve under the base's `raw/` material root, not the base dir itself.
const MATERIAL_DIR = getKnowledgeMaterialDir(BASE_ID)

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
      expect(getKnowledgeBaseFilePath(BASE_ID, 'sub/dir/file.md')).toBe(path.join(MATERIAL_DIR, 'sub/dir/file.md'))
    })
  })

  describe('getKnowledgeSourceRelativePath', () => {
    it('reduces a source path to its basename', () => {
      expect(getKnowledgeSourceRelativePath('/some/dir/report.pdf')).toBe('report.pdf')
    })
  })

  describe('toKnowledgeRelativePath', () => {
    it('returns a POSIX relative path for a path inside the base', () => {
      expect(toKnowledgeRelativePath(BASE_ID, path.join(MATERIAL_DIR, 'a', 'b.md'))).toBe('a/b.md')
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

  describe('reserveImportedFileRelativePath', () => {
    it('returns and reserves the bare name when free', () => {
      const reserved = new Set<string>()
      expect(reserveImportedFileRelativePath('paper.pdf', false, reserved)).toBe('paper.pdf')
      expect(reserved.has('paper.pdf')).toBe(true)
    })

    it('auto-renames with a `_N` suffix when the source name is already reserved', () => {
      const reserved = new Set<string>(['paper.pdf'])
      expect(reserveImportedFileRelativePath('paper.pdf', false, reserved)).toBe('paper_1.pdf')
      expect(reserved.has('paper_1.pdf')).toBe(true)
    })

    it('reserves the processed-markdown sibling alongside the source', () => {
      const reserved = new Set<string>()
      expect(reserveImportedFileRelativePath('paper.pdf', true, reserved)).toBe('paper.pdf')
      expect(reserved.has('paper.pdf')).toBe(true)
      expect(reserved.has('paper.md')).toBe(true)
    })

    it('bumps the suffix when only the processed-markdown sibling would collide', () => {
      const reserved = new Set<string>(['brief.md'])
      expect(reserveImportedFileRelativePath('brief.docx', true, reserved)).toBe('brief_1.docx')
      expect(reserved.has('brief_1.docx')).toBe(true)
      expect(reserved.has('brief_1.md')).toBe(true)
    })

    it('bumps an .xls import off an existing same-name .md so the processed artifact never overwrites it', () => {
      // The reviewer's exact case: a base already holding `report.md`, importing `report.xls`.
      // Derive the artifact flag from the real predicate (not a literal `true`) so this fails
      // if `needsProcessedArtifactReservation` ever stops treating `.xls` as a processed source
      // — that regression is what silently overwrote the existing `report.md` before the fix.
      const reserved = new Set<string>(['report.md'])
      const reserveArtifact = needsProcessedArtifactReservation('some-processor', 'report.xls')
      expect(reserveArtifact).toBe(true)
      expect(reserveImportedFileRelativePath('report.xls', reserveArtifact, reserved)).toBe('report_1.xls')
      expect(reserved.has('report_1.xls')).toBe(true)
      expect(reserved.has('report_1.md')).toBe(true)
      expect(reserved.has('report.md')).toBe(true)
    })
  })

  describe('needsProcessedArtifactReservation', () => {
    it('returns false without a file processor regardless of extension', () => {
      expect(needsProcessedArtifactReservation(null, 'report.pdf')).toBe(false)
      expect(needsProcessedArtifactReservation(undefined, 'report.xls')).toBe(false)
    })

    it.each(['report.pdf', 'paper.doc', 'paper.docx', 'deck.pptx', 'sheet.xlsx', 'sheet.xls'])(
      'reserves the processed artifact for processed source %s',
      (relativePath) => {
        expect(needsProcessedArtifactReservation('some-processor', relativePath)).toBe(true)
      }
    )

    it.each(['notes.md', 'page.txt', 'data.csv', 'book.epub'])(
      'does not reserve for non-processed knowledge source %s',
      (relativePath) => {
        expect(needsProcessedArtifactReservation('some-processor', relativePath)).toBe(false)
      }
    )

    it.each(['legacy.odt', 'deck.odp', 'sheet.ods'])(
      'does not reserve for %s — an OpenDocument format the knowledge base does not process',
      (relativePath) => {
        // These are in the app-wide `documentExts` but intentionally NOT a knowledge
        // processing/supported ext, so no `.md` artifact is ever emitted for them.
        expect(needsProcessedArtifactReservation('some-processor', relativePath)).toBe(false)
      }
    )
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
      const destPath = path.join(MATERIAL_DIR, relativePath)
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

  describe('writeFileIntoKnowledgeBaseAt', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      lstatMock.mockRejectedValue(enoent())
      ensureDirMock.mockResolvedValue(undefined)
      writeMock.mockResolvedValue(undefined)
    })

    it('rejects an unsafe target relative path before any filesystem write', async () => {
      await expect(writeFileIntoKnowledgeBaseAt(BASE_ID, '../escape.md', 'hi')).rejects.toThrow(
        'Invalid knowledge relative path'
      )
      expect(writeMock).not.toHaveBeenCalled()
    })

    it('creates parent directories and writes the content for a nested target', async () => {
      const relativePath = 'docs/sub/page.md'
      await expect(writeFileIntoKnowledgeBaseAt(BASE_ID, relativePath, '# hi')).resolves.toBe(relativePath)
      const destPath = path.join(MATERIAL_DIR, relativePath)
      expect(ensureDirMock).toHaveBeenCalledWith(path.dirname(destPath))
      expect(writeMock).toHaveBeenCalledWith(destPath, '# hi')
    })

    it('throws when the target already exists', async () => {
      lstatMock.mockResolvedValueOnce({})
      await expect(writeFileIntoKnowledgeBaseAt(BASE_ID, 'page.md', '# hi')).rejects.toThrow(
        'Knowledge file already exists'
      )
      expect(writeMock).not.toHaveBeenCalled()
    })
  })

  describe('collectKnowledgeReservedRelativePaths', () => {
    it('collects file source and indexed-artifact paths and url/note snapshot paths', () => {
      const reserved = collectKnowledgeReservedRelativePaths([
        { type: 'file', data: { relativePath: 'a.pdf', indexedRelativePath: 'a.md' } },
        { type: 'url', data: { source: 'https://x', url: 'https://x', relativePath: 'x.md' } },
        { type: 'note', data: { source: 'n', content: 'body', relativePath: 'n.md' } },
        { type: 'note', data: { source: 'uncaptured', content: 'body' } },
        { type: 'directory', data: { source: 'd', path: '/d' } }
      ])

      expect(reserved).toEqual(new Set(['a.pdf', 'a.md', 'x.md', 'n.md']))
    })

    it('ignores items with non-string or missing path fields', () => {
      const reserved = collectKnowledgeReservedRelativePaths([
        { type: 'url', data: { source: 'https://x', url: 'https://x' } },
        { type: 'file', data: null as unknown as object },
        { type: 'file', data: { relativePath: 42 } as unknown as object }
      ])

      expect(reserved.size).toBe(0)
    })

    it('reserves the prospective processed-markdown slot for an unprocessed file when a processor is set', () => {
      const reserved = collectKnowledgeReservedRelativePaths(
        [{ id: 'i1', type: 'file', data: { relativePath: 'paper.pdf' } }],
        {
          fileProcessorId: 'some-processor'
        }
      )

      expect(reserved).toEqual(new Set(['paper.pdf', 'paper.md']))
    })

    it('does not reserve a prospective slot without a processor', () => {
      const noProcessor = collectKnowledgeReservedRelativePaths([
        { id: 'i1', type: 'file', data: { relativePath: 'paper.pdf' } }
      ])
      expect(noProcessor).toEqual(new Set(['paper.pdf']))
    })

    it('does not reserve a prospective slot for a non-processed source extension', () => {
      const reserved = collectKnowledgeReservedRelativePaths(
        [{ id: 'i1', type: 'file', data: { relativePath: 'notes.md' } }],
        { fileProcessorId: 'some-processor' }
      )

      // `.md` is not a knowledge processing ext → no processed artifact is ever
      // emitted, so no prospective `.md` slot is reserved (only the source itself).
      expect(reserved).toEqual(new Set(['notes.md']))
    })

    it('reserves the prospective processed-markdown slot for an .xls source', () => {
      // `.xls` is processed into a `.md` (it is a knowledge processing ext) even though
      // it is absent from the app-wide `documentExts` — the slot must be reserved.
      const reserved = collectKnowledgeReservedRelativePaths(
        [{ id: 'i1', type: 'file', data: { relativePath: 'report.xls' } }],
        { fileProcessorId: 'some-processor' }
      )

      expect(reserved).toEqual(new Set(['report.xls', 'report.md']))
    })

    it('does not reserve a prospective slot for an OpenDocument source the base cannot process', () => {
      const reserved = collectKnowledgeReservedRelativePaths(
        [{ id: 'i1', type: 'file', data: { relativePath: 'legacy.odt' } }],
        { fileProcessorId: 'some-processor' }
      )

      expect(reserved).toEqual(new Set(['legacy.odt']))
    })

    it('reserves the pinned artifact, not the prospective slot, once the file is indexed', () => {
      // The pinned artifact has a name that is NOT the prospective slot, so the set
      // proves the prospective branch was suppressed (paper.md must be absent).
      const reserved = collectKnowledgeReservedRelativePaths(
        [{ id: 'i1', type: 'file', data: { relativePath: 'paper.pdf', indexedRelativePath: 'paper-out.md' } }],
        { fileProcessorId: 'some-processor' }
      )

      expect(reserved).toEqual(new Set(['paper.pdf', 'paper-out.md']))
      expect(reserved.has('paper.md')).toBe(false)
    })

    it('skips the excluded item so a candidate path can be tested against the rest', () => {
      const reserved = collectKnowledgeReservedRelativePaths(
        [
          { id: 'self', type: 'url', data: { source: 'https://x', url: 'https://x', relativePath: 'x.md' } },
          { id: 'other', type: 'file', data: { relativePath: 'a.pdf' } }
        ],
        { excludeItemId: 'self' }
      )

      expect(reserved).toEqual(new Set(['a.pdf']))
    })
  })
})

describe('deleteKnowledgeItemFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    removeMock.mockResolvedValue(undefined)
    rmdirMock.mockResolvedValue(undefined)
  })

  it('removes file and captured url/note snapshot paths, skipping directories and uncaptured notes', async () => {
    await deleteKnowledgeItemFiles(BASE_ID, [
      { type: 'note', data: { source: 'n', content: 'x', relativePath: 'n.md' } },
      { type: 'url', data: { source: 'https://x', url: 'https://x', relativePath: 'x.md' } },
      { type: 'note', data: { source: 'uncaptured', content: 'y' } },
      { type: 'directory', data: { source: 'd', path: '/d' } },
      { type: 'file', data: { relativePath: 'a.pdf' } }
    ])

    expect(removeMock).toHaveBeenCalledTimes(3)
    expect(removeMock).toHaveBeenCalledWith(path.join(MATERIAL_DIR, 'n.md'))
    expect(removeMock).toHaveBeenCalledWith(path.join(MATERIAL_DIR, 'x.md'))
    expect(removeMock).toHaveBeenCalledWith(path.join(MATERIAL_DIR, 'a.pdf'))
  })

  it('removes both relativePath and indexedRelativePath when they differ', async () => {
    await deleteKnowledgeItemFiles(BASE_ID, [
      { type: 'file', data: { relativePath: 'a.pdf', indexedRelativePath: 'a.md' } }
    ])

    expect(removeMock).toHaveBeenCalledTimes(2)
    expect(removeMock).toHaveBeenCalledWith(path.join(MATERIAL_DIR, 'a.pdf'))
    expect(removeMock).toHaveBeenCalledWith(path.join(MATERIAL_DIR, 'a.md'))
  })

  it('deduplicates identical relativePath and indexedRelativePath', async () => {
    await deleteKnowledgeItemFiles(BASE_ID, [
      { type: 'file', data: { relativePath: 'a.pdf', indexedRelativePath: 'a.pdf' } }
    ])

    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledWith(path.join(MATERIAL_DIR, 'a.pdf'))
  })

  it('resolves when every removal succeeds (ENOENT idempotency is handled inside remove)', async () => {
    await expect(
      deleteKnowledgeItemFiles(BASE_ID, [{ type: 'file', data: { relativePath: 'a.pdf' } }])
    ).resolves.toBeUndefined()
  })

  it('propagates a non-ENOENT removal error', async () => {
    removeMock.mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }))
    await expect(
      deleteKnowledgeItemFiles(BASE_ID, [{ type: 'file', data: { relativePath: 'a.pdf' } }])
    ).rejects.toThrow('busy')
  })

  it('prunes now-empty ancestor directories deepest-first (the directory data source shell)', async () => {
    await deleteKnowledgeItemFiles(BASE_ID, [
      { type: 'file', data: { relativePath: 'docs/sub/a.pdf' } },
      { type: 'file', data: { relativePath: 'docs/b.pdf' } }
    ])

    const prunedDirs = rmdirMock.mock.calls.map((call) => call[0])
    expect(prunedDirs).toEqual([path.join(MATERIAL_DIR, 'docs/sub'), path.join(MATERIAL_DIR, 'docs')])
  })

  it('leaves a top-level file with no ancestor directory to prune', async () => {
    await deleteKnowledgeItemFiles(BASE_ID, [{ type: 'file', data: { relativePath: 'a.pdf' } }])

    expect(rmdirMock).not.toHaveBeenCalled()
  })

  it('swallows a still-populated directory (ENOTEMPTY) without failing or warning', async () => {
    rmdirMock.mockRejectedValue(Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' }))

    await expect(
      deleteKnowledgeItemFiles(BASE_ID, [{ type: 'file', data: { relativePath: 'docs/a.pdf' } }])
    ).resolves.toBeUndefined()
    expect(rmdirMock).toHaveBeenCalledWith(path.join(MATERIAL_DIR, 'docs'))
    // ENOTEMPTY/ENOENT are expected outcomes — they must not produce log noise.
    expect(warnMock).not.toHaveBeenCalled()
  })

  it('warns (without throwing) on an unexpected prune error so it is not silently swallowed', async () => {
    rmdirMock.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }))

    await expect(
      deleteKnowledgeItemFiles(BASE_ID, [{ type: 'file', data: { relativePath: 'docs/a.pdf' } }])
    ).resolves.toBeUndefined()
    expect(warnMock).toHaveBeenCalledWith(
      'Failed to prune empty knowledge material directory',
      expect.objectContaining({ dir: 'docs', code: 'EACCES' })
    )
  })
})

describe('deleteKnowledgeItemFilesBestEffort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    removeMock.mockResolvedValue(undefined)
  })

  it('delegates to deleteKnowledgeItemFiles on the happy path without logging', async () => {
    await deleteKnowledgeItemFilesBestEffort(BASE_ID, [{ type: 'file', data: { relativePath: 'a.pdf' } }], {
      baseId: BASE_ID
    })

    expect(removeMock).toHaveBeenCalledWith(path.join(MATERIAL_DIR, 'a.pdf'))
    expect(errorMock).not.toHaveBeenCalled()
  })

  it('swallows and logs a non-ENOENT removal failure instead of throwing', async () => {
    removeMock.mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }))

    await expect(
      deleteKnowledgeItemFilesBestEffort(BASE_ID, [{ type: 'file', data: { relativePath: 'a.pdf' } }], {
        baseId: BASE_ID
      })
    ).resolves.toBeUndefined()
    expect(errorMock).toHaveBeenCalledTimes(1)
  })

  it('swallows and logs a reserved/unsafe relative path that would throw before any removal', async () => {
    await expect(
      deleteKnowledgeItemFilesBestEffort(BASE_ID, [{ type: 'file', data: { relativePath: '../escape.pdf' } }], {
        baseId: BASE_ID
      })
    ).resolves.toBeUndefined()
    expect(removeMock).not.toHaveBeenCalled()
    expect(errorMock).toHaveBeenCalledTimes(1)
  })
})
