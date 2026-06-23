import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PathStorage from '../../storage/pathStorage'

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
vi.mock('../../storage/pathStorage', async () => {
  const actual = await vi.importActual<typeof PathStorage>('../../storage/pathStorage')
  return { ...actual, writeFileIntoKnowledgeBaseAt: writeFileIntoKnowledgeBaseAtMock }
})

const { deriveUrlSnapshotSlug, captureUrlSnapshotFile } = await import('../urlSnapshot')
const { stripOkfFrontmatter } = await import('../okfFrontmatter')

describe('deriveUrlSnapshotSlug', () => {
  it('uses the first markdown heading', () => {
    expect(deriveUrlSnapshotSlug('# Quarterly Report\n\nbody', 'https://x.com')).toBe('Quarterly Report')
  })

  it('uses the first non-empty line when there is no heading', () => {
    expect(deriveUrlSnapshotSlug('\n\nJust a line\nmore', 'https://x.com')).toBe('Just a line')
  })

  it('sanitizes filesystem-forbidden characters out of the heading', () => {
    expect(deriveUrlSnapshotSlug('# A/B:C', 'https://x.com')).toBe('A_B_C')
  })

  it('truncates an overlong title to the snapshot length cap', () => {
    const slug = deriveUrlSnapshotSlug(`# ${'a'.repeat(200)}`, 'https://x.com')
    expect(slug).toHaveLength(80)
  })

  it('falls back to the URL host and last path segment when the markdown has no title', () => {
    expect(deriveUrlSnapshotSlug('   \n  ', 'https://example.com/docs/page')).toBe('example.com-page')
  })

  it('falls back to "page" when neither the markdown nor the URL yields a name', () => {
    expect(deriveUrlSnapshotSlug('', 'not a url')).toBe('page')
  })
})

describe('captureUrlSnapshotFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The real writer returns the relative path it wrote to; mirror that.
    writeFileIntoKnowledgeBaseAtMock.mockImplementation(async (_baseId: string, relativePath: string) => relativePath)
  })

  it('writes the snapshot under a heading-derived name and returns its relative path', async () => {
    const markdown = '# My Page\n\nbody'
    const relativePath = await captureUrlSnapshotFile('kb-1', 'https://example.com/p', markdown, new Set())

    expect(relativePath).toBe('My Page.md')
    expect(writeFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith('kb-1', 'My Page.md', expect.any(String))
  })

  it('prefixes the markdown with an OKF frontmatter block that strips back off exactly', async () => {
    const markdown = '# My Page\n\nbody'
    await captureUrlSnapshotFile('kb-1', 'https://example.com/p', markdown, new Set())

    const written = writeFileIntoKnowledgeBaseAtMock.mock.calls[0][2] as string
    expect(written).toMatch(/^---\ntype: "URL"\ntitle: "My Page"\nresource: "https:\/\/example\.com\/p"\n/)
    expect(written).toMatch(/timestamp: "\d{4}-\d{2}-\d{2}T[^"]+"\n/)
    expect(stripOkfFrontmatter(written)).toBe(markdown)
  })

  it('renames around an already-reserved snapshot name', async () => {
    const reserved = new Set<string>(['My Page.md'])
    const relativePath = await captureUrlSnapshotFile('kb-1', 'https://example.com/p', '# My Page\n\nbody', reserved)

    expect(relativePath).toBe('My Page_1.md')
    expect(writeFileIntoKnowledgeBaseAtMock).toHaveBeenCalledWith('kb-1', 'My Page_1.md', expect.any(String))
  })
})
