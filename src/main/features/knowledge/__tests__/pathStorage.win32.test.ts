// The material-root containment guard under Windows path semantics. It cannot be covered
// on a POSIX runner: once `assertSafeKnowledgeRelativePath` has read a value as POSIX,
// nothing can still escape when POSIX also does the joining. The gap only opens when the
// two readings disagree, so this file swaps `node:path` for `path.win32`.
import type * as NodePath from 'node:path'
import nodePath from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { PosixRelativeFilePath } from '@shared/utils/file'

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof NodePath>('node:path')
  return { ...actual.win32, default: actual.win32 }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mocked = mockApplicationFactory()
  mocked.application.getPath = vi.fn((key: string) => `C:\\Users\\me\\Data\\${key}`)
  return mocked
})

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }
}))

const brand = (value: string) => value as PosixRelativeFilePath

describe('getKnowledgeBaseFilePath on a Windows host', () => {
  it.each([
    ['a climb out of raw/', '..\\outside.pdf'],
    ['a climb past the base dir', '..\\..\\..\\evil.pdf'],
    ['a climb reached after descending', 'a\\..\\..\\x.pdf'],
    ['a value resolving back onto the material root', 'a\\..']
  ])('rejects %s, which POSIX reads as one ordinary filename', async (_label, value) => {
    // Read as POSIX these are single legal filenames containing a backslash, so the
    // storage contract accepts them and only the host-side guard can stop them.
    const { KnowledgeRelativePathSchema } = await import('@shared/data/types/knowledge')
    expect(KnowledgeRelativePathSchema.safeParse(value).success).toBe(true)

    const { getKnowledgeBaseFilePath } = await import('../pathStorage')
    expect(() => getKnowledgeBaseFilePath('b1', brand(value))).toThrow(/escapes the material root/)
  })

  it.each([
    ['a plain name', 'report.pdf'],
    ['a nested path', 'docs/sub/a.pdf'],
    ['a backslash name that Windows reads as a subdirectory but does not escape', 'a\\b.pdf'],
    ['an interior climb that stays inside', 'a\\b\\..\\c.pdf']
  ])('still resolves %s', async (_label, value) => {
    const { getKnowledgeBaseFilePath } = await import('../pathStorage')
    const resolved = getKnowledgeBaseFilePath('b1', brand(value))
    expect(
      resolved.startsWith(`${nodePath.win32.join('C:\\Users\\me\\Data\\feature.knowledgebase.data', 'b1')}\\raw\\`)
    ).toBe(true)
  })
})
