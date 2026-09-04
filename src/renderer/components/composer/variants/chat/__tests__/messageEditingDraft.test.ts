import { FILE_TYPE } from '@renderer/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { createEditableMessageDraft } from '../messageEditingDraft'

const imageParts = [
  {
    type: 'text',
    text: 'look at this',
    providerMetadata: {
      cherry: {
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file:shot-1',
              kind: 'file',
              label: 'shot.png',
              index: 0,
              textOffset: 0,
              payload: { name: 'shot.png', origin_name: 'shot.png', ext: '.png', size: 238_592, type: FILE_TYPE.IMAGE }
            }
          ]
        }
      }
    }
  },
  {
    type: 'file',
    url: 'file:///tmp/shot.png',
    mediaType: 'image/png',
    filename: 'shot.png',
    providerMetadata: { cherry: { fileTokenSourceId: 'shot-1' } }
  }
] as unknown as CherryMessagePart[]

describe('createEditableMessageDraft', () => {
  // The stored part has no filesystem path, so without the URL the edit composer has no image to preview.
  it('carries the stored file URL as the attachment preview source', async () => {
    const draft = await createEditableMessageDraft(imageParts)

    expect(draft.files).toHaveLength(1)
    expect(draft.files[0].path).toBeUndefined()
    expect(draft.files[0].previewUrl).toBe('file:///tmp/shot.png')
  })

  it('restores the attachment onto its file token so the token renders like a live one', async () => {
    const draft = await createEditableMessageDraft(imageParts)

    const fileToken = draft.draftTokens.find((token) => token.kind === 'file')
    expect(fileToken?.payload).toBe(draft.files[0])
  })

  it('recovers size and type from the stored token payload', async () => {
    const draft = await createEditableMessageDraft(imageParts)

    expect(draft.files[0].size).toBe(238_592)
    expect(draft.files[0].type).toBe(FILE_TYPE.IMAGE)
  })
})
