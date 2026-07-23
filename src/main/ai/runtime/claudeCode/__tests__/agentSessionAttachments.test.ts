import { createFileAttachmentHandle } from '@main/ai/messages/attachmentHandle'
import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listSessionMessages: vi.fn(),
  deletionListeners: new Set<(event: { sessionId: string; messageId: string }) => void>()
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listSessionMessages: mocks.listSessionMessages,
    onSessionMessageDeleted: (listener: (event: { sessionId: string; messageId: string }) => void) => {
      mocks.deletionListeners.add(listener)
      return { dispose: () => mocks.deletionListeners.delete(listener) }
    }
  }
}))

const { createAgentSessionAttachmentHolder, getAgentSessionAttachments } = await import('../agentSessionAttachments')

const attachment = (fileEntryId: string, displayName: string): FileAttachmentRef => ({
  fileEntryId,
  handle: displayName,
  displayName
})

describe('agentSessionAttachments', () => {
  beforeEach(() => {
    mocks.listSessionMessages.mockReset()
    mocks.listSessionMessages.mockReturnValue({ items: [], nextCursor: undefined })
    mocks.deletionListeners.clear()
  })

  it('does not rebind a deleted attachment handle to a same-name replacement', () => {
    const originalHolder = createAgentSessionAttachmentHolder('session-deleted')
    originalHolder.register([attachment('deleted-entry-secret', 'report.pdf')])
    const deletedHandle = originalHolder.list()[0].handle
    originalHolder.dispose()

    const rebuiltHolder = createAgentSessionAttachmentHolder('session-deleted', [
      attachment('replacement-entry-secret', 'report.pdf')
    ])
    const replacementHandle = rebuiltHolder.list()[0].handle

    expect(deletedHandle).toMatch(/^file_[a-f0-9]{16}$/)
    expect(replacementHandle).toMatch(/^file_[a-f0-9]{16}$/)
    expect(replacementHandle).not.toBe(deletedHandle)
    expect(deletedHandle).not.toContain('deleted-entry-secret')
    expect(replacementHandle).not.toContain('replacement-entry-secret')

    rebuiltHolder.dispose()
  })

  it('restores historical handles when a session reconnects', () => {
    const originalHolder = createAgentSessionAttachmentHolder('session-reconnect')
    originalHolder.register([attachment('historical-entry', 'report.pdf')])
    originalHolder.dispose()

    const reconnectedHolder = createAgentSessionAttachmentHolder('session-reconnect', [
      attachment('historical-entry', 'report.pdf')
    ])

    expect(getAgentSessionAttachments('session-reconnect')).toEqual([
      {
        fileEntryId: 'historical-entry',
        handle: createFileAttachmentHandle('historical-entry'),
        displayName: 'report.pdf'
      }
    ])

    reconnectedHolder.dispose()
  })

  it('keeps opaque handles collision-free across turns without exposing entry ids', () => {
    const holder = createAgentSessionAttachmentHolder('session-handles')

    holder.register([attachment('entry-secret-1', 'report.pdf')])
    holder.register([
      attachment('entry-secret-2', 'report.pdf (2)'),
      attachment('entry-secret-3', 'report.pdf'),
      attachment('entry-secret-1', 'renamed.pdf')
    ])

    expect(holder.list()).toEqual([
      {
        fileEntryId: 'entry-secret-1',
        handle: createFileAttachmentHandle('entry-secret-1'),
        displayName: 'report.pdf'
      },
      {
        fileEntryId: 'entry-secret-2',
        handle: createFileAttachmentHandle('entry-secret-2'),
        displayName: 'report.pdf (2)'
      },
      {
        fileEntryId: 'entry-secret-3',
        handle: createFileAttachmentHandle('entry-secret-3'),
        displayName: 'report.pdf'
      }
    ])
    const handles = holder.list().map(({ handle }) => handle)
    expect(handles.every((handle) => /^file_[a-f0-9]{16}$/.test(handle))).toBe(true)
    expect(handles.join(',')).not.toContain('entry-secret')

    holder.dispose()
  })

  it('drops attachments deleted from the persisted transcript without restarting the holder', () => {
    const holder = createAgentSessionAttachmentHolder('session-refresh')
    holder.register([attachment('deleted-entry', 'deleted.csv'), attachment('retained-entry', 'retained.csv')])
    mocks.listSessionMessages.mockReturnValue({
      items: [
        {
          id: 'retained-message',
          role: 'user',
          data: {
            parts: [
              {
                type: 'file',
                url: 'file:///tmp/renamed.csv',
                mediaType: 'text/csv',
                filename: 'renamed.csv',
                providerMetadata: { cherry: { fileEntryId: 'retained-entry' } }
              }
            ]
          }
        }
      ],
      nextCursor: undefined
    })

    for (const listener of mocks.deletionListeners) {
      listener({ sessionId: 'another-session', messageId: 'other-message' })
    }
    expect(getAgentSessionAttachments('session-refresh')).toHaveLength(2)

    for (const listener of mocks.deletionListeners) {
      listener({ sessionId: 'session-refresh', messageId: 'deleted-message' })
    }

    expect(getAgentSessionAttachments('session-refresh')).toEqual([
      {
        fileEntryId: 'retained-entry',
        handle: createFileAttachmentHandle('retained-entry'),
        displayName: 'renamed.csv'
      }
    ])
    holder.dispose()
    expect(mocks.deletionListeners.size).toBe(0)
  })

  it('keeps the same handle when an attachment is renamed between connections', () => {
    const originalHolder = createAgentSessionAttachmentHolder('session-renamed')
    originalHolder.register([attachment('stable-entry-secret', 'draft.docx')])
    const originalHandle = originalHolder.list()[0].handle
    originalHolder.dispose()

    const rebuiltHolder = createAgentSessionAttachmentHolder('session-renamed', [
      attachment('stable-entry-secret', 'final.docx')
    ])

    expect(rebuiltHolder.list()).toEqual([
      {
        fileEntryId: 'stable-entry-secret',
        handle: originalHandle,
        displayName: 'final.docx'
      }
    ])
    rebuiltHolder.dispose()
  })

  it('does not let an older connection dispose its successor attachment holder', () => {
    const oldHolder = createAgentSessionAttachmentHolder('session-replaced')
    oldHolder.register([attachment('old-entry', 'old.txt')])
    const currentHolder = createAgentSessionAttachmentHolder('session-replaced')
    currentHolder.register([attachment('new-entry', 'new.txt')])

    oldHolder.dispose()

    expect(getAgentSessionAttachments('session-replaced')).toEqual([
      { fileEntryId: 'new-entry', handle: createFileAttachmentHandle('new-entry'), displayName: 'new.txt' }
    ])

    currentHolder.dispose()
    expect(getAgentSessionAttachments('session-replaced')).toEqual([])
  })
})
