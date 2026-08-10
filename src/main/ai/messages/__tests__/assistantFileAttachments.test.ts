import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { collectAssistantFileAttachments, createAssistantFileAttachmentHandle } from '../assistantFileAttachments'

function filePart(fileEntryId: string, filename?: string): CherryMessagePart {
  return {
    type: 'file',
    url: 'file:///attachment',
    mediaType: 'application/octet-stream',
    filename,
    providerMetadata: { cherry: { fileEntryId } }
  } as CherryMessagePart
}

function message(id: string, parts: CherryMessagePart[]): CherryUIMessage {
  return { id, role: 'user', parts } as CherryUIMessage
}

describe('assistantFileAttachments', () => {
  it('creates opaque stable handles without exposing entry ids', () => {
    const first = createAssistantFileAttachmentHandle('entry-secret')
    const second = createAssistantFileAttachmentHandle('entry-secret')

    expect(first).toBe(second)
    expect(first).toMatch(/^file_[a-f0-9]{16}$/)
    expect(first).not.toContain('entry-secret')
  })

  it('deduplicates an entry while preserving its first display name', () => {
    const attachments = collectAssistantFileAttachments([
      message('message-1', [filePart('entry-1', 'first.txt')]),
      message('message-2', [filePart('entry-1', 'renamed.txt'), filePart('entry-2')])
    ])

    expect(attachments).toEqual([
      {
        fileEntryId: 'entry-1',
        handle: createAssistantFileAttachmentHandle('entry-1'),
        displayName: 'first.txt'
      },
      {
        fileEntryId: 'entry-2',
        handle: createAssistantFileAttachmentHandle('entry-2'),
        displayName: 'file'
      }
    ])
  })
})
