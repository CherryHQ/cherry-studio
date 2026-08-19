import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'
import { describe, expect, it } from 'vitest'

import { createEditableMessageDraft } from './messageEditingDraft'

describe('createEditableMessageDraft', () => {
  it('keeps a sent pasted-text attachment previewable while editing', () => {
    const filePart = withCherryMeta(
      {
        type: 'file',
        url: 'file:///tmp/pasted%20text.txt',
        mediaType: 'text/plain',
        filename: 'Pasted text.txt'
      } satisfies CherryMessagePart,
      {
        fileEntryId: 'entry-pasted-text',
        fileTokenSourceId: 'source-pasted-text',
        composerFileKind: 'pasted-text'
      }
    )

    const draft = createEditableMessageDraft([filePart])

    expect(draft.files).toEqual([
      expect.objectContaining({
        fileTokenSourceId: 'source-pasted-text',
        path: '/tmp/pasted text.txt',
        composerFileKind: 'pasted-text'
      })
    ])
  })
})
