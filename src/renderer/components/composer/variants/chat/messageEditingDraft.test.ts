import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createEditableMessageDraft } from './messageEditingDraft'

describe('createEditableMessageDraft', () => {
  const getPhysicalPath = vi.fn()

  beforeEach(() => {
    getPhysicalPath.mockReset()
    Object.assign(window.api.file, { getPhysicalPath })
  })

  async function restoreFile(url: string, composerFileKind?: 'pasted-text') {
    const part = withCherryMeta(
      {
        type: 'file',
        url,
        mediaType: 'text/plain',
        filename: 'Pasted text.txt'
      } satisfies CherryMessagePart,
      {
        fileTokenSourceId: 'source-pasted-text',
        ...(composerFileKind && { composerFileKind })
      }
    )

    return (await createEditableMessageDraft([part])).files[0]
  }

  it.each([
    ['POSIX', 'file:///tmp/pasted%20text.txt', '/tmp/pasted text.txt'],
    ['Windows drive', 'file:///C:/Users/Test/pasted%20text.txt', 'C:/Users/Test/pasted text.txt'],
    ['UNC', 'file://server/share/pasted%20text.txt', '//server/share/pasted text.txt']
  ])('keeps a sent pasted-text attachment previewable from a %s file URL', async (_, url, path) => {
    expect(await restoreFile(url, 'pasted-text')).toEqual(
      expect.objectContaining({
        fileTokenSourceId: 'source-pasted-text',
        path,
        composerFileKind: 'pasted-text'
      })
    )
  })

  it.each([
    ['ordinary attachment', 'file:///tmp/plain.txt', undefined],
    ['HTTPS URL', 'https://example.com/pasted.txt', 'pasted-text' as const],
    ['malformed percent encoding', 'file:///tmp/pasted%ZZtext.txt', 'pasted-text' as const],
    ['decoded null byte', 'file:///tmp/pasted%00text.txt', 'pasted-text' as const],
    ['non-absolute path', 'relative/pasted.txt', 'pasted-text' as const]
  ])('keeps a %s pathless and without a pasted-text marker', async (_, url, composerFileKind) => {
    const file = await restoreFile(url, composerFileKind)

    expect(file).not.toHaveProperty('path')
    expect(file).not.toHaveProperty('composerFileKind')
  })

  it('uses the current FileEntry path after the user-data directory moves', async () => {
    getPhysicalPath.mockResolvedValue('/new-user-data/Data/Files/pasted.txt')
    const part = withCherryMeta(
      {
        type: 'file',
        url: 'file:///old-user-data/Data/Files/pasted.txt',
        mediaType: 'text/plain',
        filename: 'Pasted text.txt'
      } satisfies CherryMessagePart,
      {
        fileEntryId: 'entry-pasted-text',
        fileTokenSourceId: 'source-pasted-text',
        composerFileKind: 'pasted-text'
      }
    )

    const draft = await createEditableMessageDraft([part])

    expect(draft.files[0].path).toBe('/new-user-data/Data/Files/pasted.txt')
  })

  it('does not fall back to a stale URL when the FileEntry path is unavailable', async () => {
    getPhysicalPath.mockRejectedValue(new Error('missing entry'))
    const part = withCherryMeta(
      {
        type: 'file',
        url: 'file:///old-user-data/Data/Files/pasted.txt',
        mediaType: 'text/plain',
        filename: 'Pasted text.txt'
      } satisfies CherryMessagePart,
      {
        fileEntryId: 'entry-pasted-text',
        fileTokenSourceId: 'source-pasted-text',
        composerFileKind: 'pasted-text'
      }
    )

    const file = (await createEditableMessageDraft([part])).files[0]

    expect(file).not.toHaveProperty('path')
    expect(file).not.toHaveProperty('composerFileKind')
  })
})
