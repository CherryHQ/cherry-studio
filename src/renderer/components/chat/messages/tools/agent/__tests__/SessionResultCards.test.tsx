import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'
import type { NormalToolResponse } from '@renderer/types/mcpTool'

import { MessagePartsScopeProvider } from '../../../blocks/MessagePartsContext'

const navigateToRoute = vi.hoisted(() => vi.fn())

vi.mock('../../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ navigateToRoute }),
  useOptionalMessageListTopicId: () => 'topic-1'
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'message.tools.sessionCreate.created': 'Session created',
        'message.tools.sessionCreate.open': 'Open session',
        'message.tools.sessionCreate.untitled': 'Untitled session',
        'message.tools.sessionRead.read': 'Read conversation',
        'message.tools.sessionSearch.found': 'Found session',
        'message.tools.sessionSend.sent': 'Sent to'
      })[key] ?? key
  })
}))

import { SessionResultCards } from '../SessionResultCards'

function toolResponse(name: string, response: unknown, input?: Record<string, unknown>): NormalToolResponse {
  return {
    id: name,
    toolCallId: name,
    tool: { id: name, name, type: 'builtin' },
    arguments: input,
    status: 'done',
    response
  }
}

function renderCards(toolResponses: NormalToolResponse[]) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MessagePartsScopeProvider messageId="message-1" parts={[]}>
        <SessionResultCards toolResponses={toolResponses} />
      </MessagePartsScopeProvider>
    </SWRConfig>
  )
}

describe('SessionResultCards', () => {
  beforeEach(() => {
    navigateToRoute.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens completed create and send targets directly', async () => {
    const user = userEvent.setup()
    renderCards([
      toolResponse('session_create', { ok: true, sessionId: 'session-created' }, { title: 'Research session' }),
      toolResponse('session_send', {
        ok: true,
        delivery: {
          receiver: { sessionId: 'session-build' },
          receiverSnapshot: { agentName: 'Builder', sessionName: 'Build session' }
        }
      })
    ])

    expect(screen.getByText('Session created')).toBeInTheDocument()
    expect(screen.getByText('Sent to')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open session: Research session' }))
    expect(navigateToRoute).toHaveBeenLastCalledWith({
      path: '/app/agents',
      query: { sessionId: 'session-created' }
    })
    await user.click(screen.getByRole('button', { name: 'Open session: Builder / Build session' }))
    expect(navigateToRoute).toHaveBeenLastCalledWith({
      path: '/app/agents',
      query: { sessionId: 'session-build' }
    })
  })

  it('opens a searched agent session and a read chat topic on their own surfaces', async () => {
    const user = userEvent.setup()
    renderCards([
      toolResponse('session_search', {
        sessions: [{ sessionId: 'session-found', sessionName: 'Deep research chat' }]
      }),
      toolResponse('session_read', { source: 'topic', sessionId: 'topic-read', messages: [] })
    ])

    expect(screen.getByText('Found session')).toBeInTheDocument()
    expect(screen.getByText('Read conversation')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open session: Deep research chat' }))
    expect(navigateToRoute).toHaveBeenLastCalledWith({
      path: '/app/agents',
      query: { sessionId: 'session-found' }
    })
    await user.click(screen.getByRole('button', { name: 'Open session: Untitled session' }))
    expect(navigateToRoute).toHaveBeenLastCalledWith({
      path: '/app/chat',
      query: { topicId: 'topic-read' }
    })
  })

  it('loads persisted search results in the message scope and opens the full result', async () => {
    const user = userEvent.setup()
    const request = vi.spyOn(ipcApi, 'request').mockResolvedValue({
      found: true,
      output: {
        metadata: { type: 'mcp', serverId: 'cherry-tools' },
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sessions: [{ sessionId: 'saved-session', sessionName: 'Saved discussion' }]
            })
          }
        ]
      }
    })
    renderCards([
      toolResponse('session_search', {
        $persistedToolOutput: {
          shape: 'text',
          fileEntryId: 'entry-1',
          vfsFilename: 'vfs_1.txt',
          head: '{"sessions":[',
          tail: ']}',
          totalChars: 50000,
          totalLines: 100
        }
      })
    ])

    await user.click(await screen.findByRole('button', { name: 'Open session: Saved discussion' }))
    expect(request).toHaveBeenCalledWith('ai.tool.get_result', {
      topicId: 'topic-1',
      messageId: 'message-1',
      toolCallId: 'session_search'
    })
    expect(navigateToRoute).toHaveBeenCalledWith({ path: '/app/agents', query: { sessionId: 'saved-session' } })
  })

  it('does not turn unavailable deferred output into a navigation target', async () => {
    const result = Promise.withResolvers<{ found: boolean }>()
    const request = vi.spyOn(ipcApi, 'request').mockReturnValue(result.promise)
    const ref = { topicId: 'topic-1', messageId: 'message-1', toolCallId: 'session_read' }
    renderCards([toolResponse('session_read', { $deferredToolResult: ref }, { session_id: 'missing-session' })])
    await waitFor(() => expect(request).toHaveBeenCalledWith('ai.tool.get_result', ref))
    await act(async () => {
      result.resolve({ found: false })
    })
    expect(screen.queryByRole('button', { name: /Open session/ })).not.toBeInTheDocument()
  })
})
