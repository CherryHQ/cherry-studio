import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getKnowledgeItemConflictKey, getKnowledgeItemDisplayTitle } from '@shared/data/types/knowledge'

import type * as PathStorage from '../../../pathStorage'

const { writeFileIntoKnowledgeBaseAtMock } = vi.hoisted(() => ({
  writeFileIntoKnowledgeBaseAtMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
  }
}))

// Keep reserveImportedFileRelativePath real (it is pure); only stub the disk write so
// the test exercises name derivation + dedupe without touching the filesystem.
vi.mock('../../../pathStorage', async () => {
  const actual = await vi.importActual<typeof PathStorage>('../../../pathStorage')
  return { ...actual, writeFileIntoKnowledgeBaseAt: writeFileIntoKnowledgeBaseAtMock }
})

const { deriveNoteSnapshotSlug, captureNoteSnapshotFile } = await import('../noteSnapshot')
const { stripOkfFrontmatter } = await import('../okfFrontmatter')

describe('deriveNoteSnapshotSlug', () => {
  it('uses the note source title', () => {
    expect(deriveNoteSnapshotSlug('React best practices')).toBe('React best practices')
  })

  it('sanitizes filesystem-forbidden characters out of the title', () => {
    expect(deriveNoteSnapshotSlug('A/B:C')).toBe('A_B_C')
  })

  it('truncates an overlong title to the snapshot length cap', () => {
    expect(deriveNoteSnapshotSlug('a'.repeat(200))).toHaveLength(80)
  })

  it('falls back to "note" when the title sanitizes to nothing usable', () => {
    expect(deriveNoteSnapshotSlug('   ')).toBe('note')
  })

  it('names a multi-line source by its first line', () => {
    // Newlines are control characters, so sanitizing the whole source would fold the body into the
    // name (`Meeting notes__- item one`) instead of titling the note.
    expect(deriveNoteSnapshotSlug('Meeting notes\n\n- item one')).toBe('Meeting notes')
  })

  it('drops a separator the length cap lands on', () => {
    // Sanitizing turns the tab into `_`, which the trailing-whitespace strip can no longer remove.
    expect(deriveNoteSnapshotSlug(`${'a'.repeat(79)}\tmore`)).toBe('a'.repeat(79))
  })
})

describe('note canonical name', () => {
  // The v1 migrator sets `source = content` for a legacy note with no sourceUrl, so a multi-line
  // source is a legitimate shape. Detection has to predict the captured name before capture
  // happens, so all three views of the name have to agree or a re-add silently misses.
  it('keeps the pre-capture key, the captured snapshot name, and the post-capture key identical', async () => {
    writeFileIntoKnowledgeBaseAtMock.mockClear()
    writeFileIntoKnowledgeBaseAtMock.mockImplementation(async (_baseId: string, relativePath: string) => relativePath)
    const source = 'Meeting notes\n\n- item one'

    const preCaptureKey = getKnowledgeItemConflictKey({ type: 'note', data: { source, content: source } })
    // Go through the real capture rather than the slug alone, so the post-capture key is read back
    // off the path the note is actually stored under.
    const relativePath = await captureNoteSnapshotFile('kb-1', source, source, new Set())
    const postCaptureKey = getKnowledgeItemConflictKey({
      type: 'note',
      data: { source, content: source, relativePath }
    })

    expect(relativePath).toBe('Meeting notes.md')
    expect(preCaptureKey).toBe('Meeting notes')
    expect(postCaptureKey).toBe('Meeting notes')
    // The portable snapshot titles itself the same way instead of restating the body...
    expect(writeFileIntoKnowledgeBaseAtMock.mock.calls[0][2]).toMatch(/^---\ntype: "Note"\ntitle: "Meeting notes"\n/)
    // ...and so does the row.
    expect(getKnowledgeItemDisplayTitle({ type: 'note', data: { source, content: source } })).toBe('Meeting notes')
  })
})

describe('captureNoteSnapshotFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The real writer returns the relative path it wrote to; mirror that.
    writeFileIntoKnowledgeBaseAtMock.mockImplementation(async (_baseId: string, relativePath: string) => relativePath)
  })

  it('writes an OKF-frontmatter snapshot under a title-derived name and returns its relative path', async () => {
    const content = '# My note\n\nbody'
    const relativePath = await captureNoteSnapshotFile('kb-1', 'My note', content, new Set())

    expect(relativePath).toBe('My note.md')
    const written = writeFileIntoKnowledgeBaseAtMock.mock.calls[0][2] as string
    expect(written).toMatch(/^---\ntype: "Note"\ntitle: "My note"\n/)
    expect(written).toMatch(/timestamp: "\d{4}-\d{2}-\d{2}T[^"]+"\n/)
    // The frontmatter strips back off to recover the canonical note content.
    expect(stripOkfFrontmatter(written)).toBe(content)
  })

  it('renames around an already-reserved snapshot name', async () => {
    const reserved = new Set<string>(['My note.md'])
    const relativePath = await captureNoteSnapshotFile('kb-1', 'My note', 'body', reserved)

    expect(relativePath).toBe('My note_1.md')
    expect(writeFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith('kb-1', 'My note_1.md', expect.any(String))
  })
})
