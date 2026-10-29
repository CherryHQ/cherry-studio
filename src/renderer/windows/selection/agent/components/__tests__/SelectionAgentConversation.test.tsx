import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import { getAgentDraftCacheKey } from '@renderer/components/composer/variants/agent/agentDraftCache'
import { createQuoteToken } from '@renderer/components/composer/variants/shared/composerQuote'
import { takeAgentDraftHandoffs } from '@renderer/services/agentDraftHandoff'
import type { TopicStreamStatus } from '@shared/ai/transport'

const mocks = vi.hoisted(() => ({
  status: undefined as TopicStreamStatus | undefined,
  editing: undefined as { messageId: string } | undefined,
  stop: vi.fn(async () => undefined),
  ipcRequest: vi.fn(),
  toastError: vi.fn(),
  openInMainWindow: undefined as (() => void) | undefined,
  agent: undefined as
    | { id: string; name: string; type: string; model: string | null; modelName: string | null }
    | undefined,
  model: undefined as { id: string } | undefined,
  sendMessage: vi.fn(async () => true)
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/hooks/agent/useSession', () => ({
  useSession: (sessionId: string) => ({ session: { id: sessionId, agentId: 'agent-1', name: '' } })
}))
vi.mock('@renderer/hooks/agent/useAgent', () => ({ useAgent: () => ({ agent: mocks.agent, isLoading: false }) }))
vi.mock('@renderer/hooks/useModel', () => ({ useModelById: () => ({ model: mocks.model }) }))
vi.mock('@renderer/hooks/agent/useAgentWorkspaceWarning', () => ({ useAgentWorkspaceWarning: () => undefined }))
vi.mock('@renderer/pages/agents/useAgentChatRuntimeState', () => ({
  useAgentChatRuntimeState: ({ sessionId }: { sessionId: string }) => ({
    sessionId,
    sendMessage: mocks.sendMessage,
    uiMessages: [],
    partsByMessageId: {},
    isPending: false,
    stop: mocks.stop,
    editing: mocks.editing
  })
}))
vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({ useTopicStreamStatus: () => ({ status: mocks.status }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))
vi.mock('@renderer/pages/agents/components/AgentSessionMessages', () => ({ default: () => null }))
vi.mock('@renderer/pages/agents/AgentComposerSlot', () => ({ default: () => null }))
vi.mock('../SelectionAgentHeader', () => ({
  SelectionAgentHeader: (props: { onOpenInMainWindow?: () => void }) => {
    mocks.openInMainWindow = props.onOpenInMainWindow
    return null
  }
}))
vi.mock('@renderer/services/toast', () => ({ toast: { error: mocks.toastError } }))

const { SelectionAgentConversation } = await import('../SelectionAgentConversation')

const quote = createQuoteToken('x is undefined', 'Quote')
const QUOTE_DRAFT: ComposerSerializedDraft = {
  text: `${quote.promptText}\nWhy?`,
  tokens: [{ ...quote, index: 0, textOffset: 0 }]
}

function renderConversation(firstMessage: ComposerSerializedDraft = QUOTE_DRAFT) {
  return render(
    <SelectionAgentConversation
      sessionId="session-1"
      firstMessage={firstMessage}
      isPinned={false}
      onTogglePin={() => undefined}
      opacity={100}
      onOpacityChange={() => undefined}
    />
  )
}

describe('SelectionAgentConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agent = { id: 'agent-1', name: 'Dev', type: 'claude-code', model: 'openai::gpt-5', modelName: 'GPT-5' }
    mocks.model = { id: 'openai::gpt-5' }
    mocks.status = undefined
    mocks.editing = undefined
    mocks.ipcRequest.mockReset()
    MockUseCacheUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    takeAgentDraftHandoffs('session-1')
  })

  it('sends the first message once, keeping its quote token, and keeps nothing back once accepted', async () => {
    const { rerender } = renderConversation()
    rerender(
      <SelectionAgentConversation
        sessionId="session-1"
        firstMessage={QUOTE_DRAFT}
        isPinned
        onTogglePin={() => undefined}
        opacity={80}
        onOpacityChange={() => undefined}
      />
    )
    await act(async () => {})

    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith(
      { text: QUOTE_DRAFT.text },
      {
        body: expect.objectContaining({
          agentId: 'agent-1',
          sessionId: 'session-1',
          userMessageParts: [
            expect.objectContaining({
              text: QUOTE_DRAFT.text,
              providerMetadata: {
                cherry: { composer: expect.objectContaining({ tokens: [expect.objectContaining({ kind: 'quote' })] }) }
              }
            })
          ]
        })
      }
    )
    expect(takeAgentDraftHandoffs('session-1')).toEqual([])
  })

  it('hands a rejected first message back to the session composer, quote and all', async () => {
    mocks.sendMessage.mockResolvedValueOnce(false)
    renderConversation()
    await act(async () => {})

    expect(takeAgentDraftHandoffs('session-1')).toEqual([{ ...QUOTE_DRAFT, files: [], knowledgeBaseIds: [] }])
  })

  it('holds the first message while the agent has no model, then sends it once one is set', () => {
    mocks.agent = { id: 'agent-1', name: 'Cherry Assistant', type: 'claude-code', model: null, modelName: null }
    mocks.model = undefined
    const { rerender } = renderConversation({ text: 'Summarize this', tokens: [] })

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByText('selection.agent.no_model_notice')).toBeInTheDocument()

    mocks.agent = { ...mocks.agent, model: 'openai::gpt-5', modelName: 'GPT-5' }
    mocks.model = { id: 'openai::gpt-5' }
    rerender(
      <SelectionAgentConversation
        sessionId="session-1"
        firstMessage={{ text: 'Summarize this', tokens: [] }}
        isPinned={false}
        onTogglePin={() => undefined}
        opacity={100}
        onOpacityChange={() => undefined}
      />
    )

    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith(
      { text: 'Summarize this' },
      {
        body: {
          agentId: 'agent-1',
          sessionId: 'session-1',
          userMessageParts: [{ type: 'text', text: 'Summarize this' }]
        }
      }
    )
  })

  describe('state rules', () => {
    const closeRequests = () => mocks.ipcRequest.mock.calls.filter(([route]) => route === 'window.close').length
    const lastReplaceable = () =>
      mocks.ipcRequest.mock.calls.filter(([route]) => route === 'selection.set_agent_window_replaceable').at(-1)?.[1]
    const pressEscape = () => act(() => void fireEvent.keyDown(window, { key: 'Escape' }))
    const setDraft = (draft: { text?: string; files?: unknown[] }) =>
      MockUseCacheUtils.setCacheValue(getAgentDraftCacheKey('session-1'), {
        text: draft.text ?? '',
        tokens: [],
        files: (draft.files ?? []) as never[],
        knowledgeBaseIds: [],
        workspaceKey: '',
        agentId: ''
      })
    const renderAt = (status: TopicStreamStatus | undefined) => {
      mocks.status = status
      return renderConversation()
    }

    beforeEach(() => {
      MockUsePreferenceUtils.setPreferenceValue('feature.selection.auto_close', true)
    })

    it('stays open until the first turn shows up', () => {
      renderAt(undefined)

      fireEvent.blur(window)
      pressEscape()

      expect(closeRequests()).toBe(0)
      expect(lastReplaceable()).toBe(false)
    })

    it('stops a running turn on Esc and keeps it on blur', () => {
      renderAt('streaming')

      pressEscape()
      fireEvent.blur(window)

      expect(mocks.stop).toHaveBeenCalledOnce()
      expect(closeRequests()).toBe(0)
    })

    it('leaves Esc to the approval prompt while a tool waits for approval', () => {
      renderAt('awaiting-approval')

      pressEscape()
      fireEvent.blur(window)

      expect(mocks.stop).not.toHaveBeenCalled()
      expect(closeRequests()).toBe(0)
      expect(lastReplaceable()).toBe(false)
    })

    it('closes a settled turn on blur once the stream entry is gone', () => {
      const { rerender } = renderAt('streaming')
      mocks.status = undefined
      rerender(
        <SelectionAgentConversation
          sessionId="session-1"
          firstMessage={QUOTE_DRAFT}
          isPinned={false}
          onTogglePin={() => undefined}
          opacity={100}
          onOpacityChange={() => undefined}
        />
      )

      expect(lastReplaceable()).toBe(true)
      fireEvent.blur(window)
      expect(closeRequests()).toBe(1)
    })

    it('keeps a settled turn whose composer holds text or an attachment', () => {
      setDraft({ text: 'And the second one?' })
      const { unmount } = renderAt('done')
      fireEvent.blur(window)
      pressEscape()
      expect(lastReplaceable()).toBe(false)
      unmount()

      setDraft({
        files: [
          { fileTokenSourceId: 'f1', name: 'log.txt', origin_name: 'log.txt', ext: '.txt', size: 3, type: 'text' }
        ]
      })
      renderAt('error')
      fireEvent.blur(window)

      expect(closeRequests()).toBe(0)
      expect(lastReplaceable()).toBe(false)
    })

    it('keeps a settled turn while a sent message is being edited', () => {
      mocks.editing = { messageId: 'user-1' }
      renderAt('done')

      fireEvent.blur(window)
      pressEscape()

      expect(closeRequests()).toBe(0)
      expect(lastReplaceable()).toBe(false)
    })

    it('closes a settled turn on Esc', () => {
      renderAt('aborted')

      pressEscape()

      expect(closeRequests()).toBe(1)
    })
  })

  describe('open in main window', () => {
    const focusRequests = () =>
      mocks.ipcRequest.mock.calls.filter(([route]) => route === 'navigation.focus_or_open_conversation')
    const closeRequests = () => mocks.ipcRequest.mock.calls.filter(([route]) => route === 'window.close')
    const pasted = {
      fileTokenSourceId: 'pasted-1',
      // jsdom's Blob has no arrayBuffer(); this stands in for the in-memory attachment.
      blob: { type: 'image/png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Blob,
      name: 'shot.png',
      origin_name: 'shot.png',
      ext: '.png',
      size: 3,
      type: 'image' as const
    }

    it('hands the unsent draft to the main window, then closes', async () => {
      MockUseCacheUtils.setCacheValue(getAgentDraftCacheKey('session-1'), {
        text: 'And the tests?',
        tokens: [],
        files: [pasted],
        knowledgeBaseIds: ['kb-1'],
        workspaceKey: 'ws',
        agentId: 'agent-1'
      })
      renderConversation()

      await act(async () => mocks.openInMainWindow?.())

      expect(focusRequests()).toEqual([
        [
          'navigation.focus_or_open_conversation',
          {
            target: { conversationType: 'agent', conversationId: 'session-1' },
            title: 'Dev',
            draft: {
              text: 'And the tests?',
              tokens: [],
              files: [
                {
                  fileTokenSourceId: 'pasted-1',
                  bytes: new Uint8Array([1, 2, 3]),
                  mimeType: 'image/png',
                  name: 'shot.png',
                  origin_name: 'shot.png',
                  ext: '.png',
                  size: 3,
                  type: 'image'
                }
              ],
              knowledgeBaseIds: ['kb-1']
            }
          }
        ]
      ])
      expect(closeRequests()).toHaveLength(1)
    })

    it('sends no draft when the composer is empty', async () => {
      renderConversation()

      await act(async () => mocks.openInMainWindow?.())

      expect(focusRequests()[0][1]).not.toHaveProperty('draft')
    })

    it('stays open with its draft when the main window could not take the session', async () => {
      mocks.ipcRequest.mockImplementation(async (route: string) => {
        if (route === 'navigation.focus_or_open_conversation')
          throw new Error('Conversation navigation was not completed')
      })
      renderConversation()

      await act(async () => mocks.openInMainWindow?.())

      expect(closeRequests()).toHaveLength(0)
      expect(mocks.toastError).toHaveBeenCalledWith('selection.agent.open_in_main_window_failed')
    })
  })
})
