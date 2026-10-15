import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AssistantAttachmentSelection } from '@cherrystudio/remote-protocol/assistant'
import type * as Ui from '@cherrystudio/ui'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '@renderer/components/chat/messages/types'

import { TopicPendingAttachments } from '../TopicPendingAttachments'

const { request, listeners } = vi.hoisted(() => ({
  request: vi.fn(),
  listeners: new Map<string, (event: { topicId: string }) => void>()
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request,
    on: (event: string, listener: (event: { topicId: string }) => void) => {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    }
  }
}))
vi.mock('@data/hooks/useDataApi', () => ({ useQuery: () => ({ data: undefined }) }))
vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof Ui>())
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const value: MessageListProviderValue = {
  state: {
    topic: { id: 'topic' } as MessageListProviderValue['state']['topic'],
    messages: [],
    partsByMessageId: {},
    messageNavigation: 'none',
    estimateSize: 400,
    overscan: 0,
    loadOlderDelayMs: 0,
    loadingResetDelayMs: 0,
    renderConfig: defaultMessageRenderConfig
  },
  actions: {},
  meta: { selectionLayer: false }
}
const selection = (filename: string): AssistantAttachmentSelection => ({
  topicId: 'topic',
  selectionId: 'selection',
  sequence: '1',
  items: [
    {
      attachmentId: 'attachment',
      uploadId: 'upload',
      filename,
      mediaType: 'application/pdf',
      byteLength: 2048
    }
  ]
})

describe('Assistant topic pending attachments', () => {
  beforeEach(() => {
    request.mockReset()
    listeners.clear()
  })

  it('reads the topic presence route and refreshes only for its own topic', async () => {
    request.mockResolvedValue([selection('first.pdf')])
    render(
      <MessageListProvider value={value}>
        <TopicPendingAttachments topicId="topic" messageIds={[]} />
      </MessageListProvider>
    )
    expect(await screen.findByText('first.pdf')).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('ai.topic.attachment_selections.list', { topicId: 'topic' })

    request.mockResolvedValue([selection('second.pdf')])
    const changed = listeners.get('ai.topic.attachment_selections.changed')!
    await act(async () => changed({ topicId: 'other' }))
    expect(screen.getByText('first.pdf')).toBeInTheDocument()
    await act(async () => changed({ topicId: 'topic' }))
    expect(await screen.findByText('second.pdf')).toBeInTheDocument()
  })
})
