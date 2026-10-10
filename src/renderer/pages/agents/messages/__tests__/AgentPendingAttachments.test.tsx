import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentAttachmentSelection } from '@cherrystudio/remote-protocol/agent'
import type * as Ui from '@cherrystudio/ui'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '@renderer/components/chat/messages/types'

import { AgentPendingAttachments } from '../AgentPendingAttachments'

const { request, listeners } = vi.hoisted(() => ({
  request: vi.fn(),
  listeners: new Set<(event: { sessionId: string }) => void>()
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request,
    on: (_: string, listener: (event: { sessionId: string }) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
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
    topic: { id: 'session' } as MessageListProviderValue['state']['topic'],
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
const selection = (sessionId: string, filename = 'report.pdf'): AgentAttachmentSelection => ({
  sessionId,
  selectionId: 'selection',
  sequence: '1',
  items: [
    {
      attachmentId: 'attachment',
      uploadId: 'upload',
      filename,
      mediaType: 'application/pdf',
      byteLength: 2048,
      upload: {
        uploadId: 'upload',
        state: 'receiving',
        committedOffset: '1024',
        writerEpoch: '1',
        expiresAt: new Date().toISOString()
      }
    }
  ]
})
const view = (sessionId = 'a', messageIds: string[] = []) => (
  <MessageListProvider value={value}>
    <AgentPendingAttachments sessionId={sessionId} messageIds={messageIds} />
  </MessageListProvider>
)
async function changed(sessionId = 'a') {
  await act(async () => {
    for (const listener of listeners) listener({ sessionId })
  })
}

describe('remote pending attachments', () => {
  beforeEach(() => {
    request.mockReset()
    listeners.clear()
  })

  it('shows transfer progress without file actions, then hands off only when the committed message is visible', async () => {
    const row = selection('a')
    request.mockResolvedValue([row])
    const { rerender } = render(view())
    expect(await screen.findByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('2 KB · PDF')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'report.pdf' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'common.preview' })).not.toBeInTheDocument()

    request.mockResolvedValue([
      {
        ...row,
        messageId: 'committed',
        items: [{ ...row.items[0], upload: { ...row.items[0].upload, state: 'ready' } }]
      }
    ])
    await changed()
    expect(screen.getByText('knowledge.data_source.status.ready')).toBeInTheDocument()
    rerender(view('a', ['committed']))
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument()
  })

  it('ignores a late response from the previous session', async () => {
    let resolveOld!: (rows: AgentAttachmentSelection[]) => void
    request.mockImplementation((_route, { sessionId }) =>
      sessionId === 'a'
        ? new Promise<AgentAttachmentSelection[]>((resolve) => {
            resolveOld = resolve
          })
        : Promise.resolve([selection('b', 'current.pdf')])
    )
    const { rerender } = render(view('a'))
    rerender(view('b'))
    expect(await screen.findByText('current.pdf')).toBeInTheDocument()
    await act(async () => resolveOld([selection('a', 'old.pdf')]))
    expect(screen.queryByText('old.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('current.pdf')).toBeInTheDocument()
  })

  it('reconciles an invalidation received while a snapshot is in flight', async () => {
    let finish!: (rows: AgentAttachmentSelection[]) => void
    request
      .mockReturnValueOnce(
        new Promise<AgentAttachmentSelection[]>((resolve) => {
          finish = resolve
        })
      )
      .mockResolvedValue([])
    render(view())
    await changed()
    await act(async () => finish([selection('a', 'removed.pdf')]))
    expect(screen.queryByText('removed.pdf')).not.toBeInTheDocument()
  })
})
