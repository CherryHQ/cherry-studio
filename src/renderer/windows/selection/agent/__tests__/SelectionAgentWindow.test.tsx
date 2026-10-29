import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import type { ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import type { SelectionActionSession } from '@shared/types/selection'

const mocks = vi.hoisted(() => ({
  action: null as SelectionActionSession | null,
  ipcRequest: vi.fn(),
  composeSend: null as ((draft: ComposerSerializedDraft) => void) | null,
  composeType: null as ((text: string) => void) | null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => (options?.app ? `${key}:${options.app}` : key)
  })
}))
vi.mock('@renderer/hooks/useWindowInitData', () => ({ useWindowInitData: () => mocks.action }))
vi.mock('@renderer/hooks/agent/useAgent', () => ({ useAgent: () => ({ agent: undefined }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))

// The real composers throw without a quick panel context, so the stand-ins require one too.
vi.mock('../components/SelectionAgentComposeBar', () => ({
  SelectionAgentComposeBar: (props: {
    error: string | null
    onSend: (draft: ComposerSerializedDraft) => void
    onTextChange: (text: string) => void
  }) => {
    useQuickPanel()
    mocks.composeSend = props.onSend
    mocks.composeType = props.onTextChange
    return <div data-testid="compose-bar">{props.error}</div>
  }
}))
vi.mock('../components/SelectionAgentConversation', () => ({
  SelectionAgentConversation: (props: { sessionId: string; firstMessage: unknown }) => {
    useQuickPanel()
    return <pre data-testid="conversation">{JSON.stringify(props)}</pre>
  }
}))

const { default: SelectionAgentWindow } = await import('../SelectionAgentWindow')

const ASK_AGENT: SelectionActionSession = {
  id: 'ask-agent',
  name: 'selection.action.builtin.ask_agent',
  enabled: true,
  isBuiltIn: true,
  selectedText: 'TypeError: x is undefined',
  programName: 'Terminal',
  sessionId: 'open-1'
}
const BOUND_WORKSPACE = { type: 'user', workspaceId: 'ws-1' } as const
const BOUND_ASK_AGENT: SelectionActionSession = { ...ASK_AGENT, agentId: 'agent-1', agentWorkspace: BOUND_WORKSPACE }
const QUOTE_DRAFT: ComposerSerializedDraft = {
  text: '<blockquote>\n\nTypeError: x is undefined\n</blockquote>\nFrom Terminal\nWhy?',
  tokens: []
}

const conversationProps = () => JSON.parse(screen.getByTestId('conversation').textContent ?? '{}')
const requestsTo = (route: string) => mocks.ipcRequest.mock.calls.filter(([name]) => name === route)

describe('SelectionAgentWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockDataApiUtils.resetMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.action_items', [])
    mocks.composeSend = null
    mocks.composeType = null
    mocks.ipcRequest.mockImplementation(async (route: string) =>
      route === 'ai.agent.assistant_session.create' ? { sessionId: 'assistant-session' } : undefined
    )
  })

  it('opens Ask Agent as a compose bar without creating a session', () => {
    mocks.action = ASK_AGENT
    render(<SelectionAgentWindow />)

    expect(screen.getByTestId('compose-bar')).toBeInTheDocument()
    expect(requestsTo('ai.agent.assistant_session.create')).toHaveLength(0)
    expect(dataApiService.post).not.toHaveBeenCalled()
  })

  it('creates one Cherry Assistant session on the first send and expands into the conversation', async () => {
    mocks.action = ASK_AGENT
    render(<SelectionAgentWindow />)

    await act(async () => mocks.composeSend?.(QUOTE_DRAFT))

    expect(requestsTo('ai.agent.assistant_session.create')).toEqual([
      ['ai.agent.assistant_session.create', { workspace: { type: 'system' } }]
    ])
    expect(mocks.ipcRequest).toHaveBeenCalledWith('selection.resize_agent_window', { mode: 'conversation' })
    const { sessionId, firstMessage } = conversationProps()
    expect(sessionId).toBe('assistant-session')
    expect(firstMessage.text).toBe(QUOTE_DRAFT.text)
    expect(firstMessage.userMessageParts).toEqual([expect.objectContaining({ type: 'text', text: QUOTE_DRAFT.text })])
  })

  it('creates the session under a bound agent and workspace through the session API', async () => {
    MockDataApiUtils.setCustomResponse('/agent-sessions', 'POST', { id: 'bound-session' })
    mocks.action = BOUND_ASK_AGENT
    render(<SelectionAgentWindow />)

    await act(async () => mocks.composeSend?.(QUOTE_DRAFT))

    expect(dataApiService.post).toHaveBeenCalledWith('/agent-sessions', {
      body: { agentId: 'agent-1', name: '', workspace: BOUND_WORKSPACE }
    })
    expect(conversationProps().sessionId).toBe('bound-session')
  })

  it('sends to the binding as the selection settings hold it now, not as it was when the window opened', async () => {
    MockDataApiUtils.setCustomResponse('/agent-sessions', 'POST', { id: 'rebound-session' })
    mocks.action = ASK_AGENT
    MockUsePreferenceUtils.setPreferenceValue('feature.selection.action_items', [
      {
        id: 'ask-agent',
        name: ASK_AGENT.name,
        enabled: true,
        isBuiltIn: true,
        agentId: 'agent-1',
        agentWorkspace: BOUND_WORKSPACE
      }
    ] satisfies SelectionActionItem[])
    render(<SelectionAgentWindow />)

    await act(async () => mocks.composeSend?.(QUOTE_DRAFT))

    expect(dataApiService.post).toHaveBeenCalledWith('/agent-sessions', {
      body: { agentId: 'agent-1', name: '', workspace: BOUND_WORKSPACE }
    })
  })

  it('keeps the compose bar and names the cause when the workspace no longer exists', async () => {
    MockDataApiUtils.setErrorResponse('/agent-sessions', 'POST', DataApiErrorFactory.notFound('Workspace', 'ws-1'))
    mocks.action = BOUND_ASK_AGENT
    render(<SelectionAgentWindow />)

    await act(async () => mocks.composeSend?.(QUOTE_DRAFT))

    expect(screen.getByTestId('compose-bar')).toHaveTextContent('selection.agent.workspace_unavailable_hint')
    expect(screen.queryByTestId('conversation')).not.toBeInTheDocument()
  })

  it('sends an agent-bound custom action right away with its prompt expanded', async () => {
    MockDataApiUtils.setCustomResponse('/agent-sessions', 'POST', { id: 'custom-session' })
    mocks.action = {
      id: 'user-1',
      name: 'Vocabulary',
      enabled: true,
      isBuiltIn: false,
      runner: 'agent',
      agentId: 'agent-1',
      prompt: 'Add the hard words in {{text}} to my list',
      selectedText: 'ubiquity',
      programName: 'Chrome',
      sessionId: 'open-2'
    }
    await act(async () => {
      render(<SelectionAgentWindow />)
    })

    expect(screen.queryByTestId('compose-bar')).not.toBeInTheDocument()
    expect(conversationProps()).toMatchObject({
      sessionId: 'custom-session',
      firstMessage: { text: 'Add the hard words in ubiquity to my list' }
    })
  })

  it('offers a retry when an agent-bound custom action could not start', async () => {
    MockDataApiUtils.setErrorResponse('/agent-sessions', 'POST', new Error('database is locked'))
    mocks.action = {
      id: 'user-1',
      name: 'Vocabulary',
      enabled: true,
      isBuiltIn: false,
      runner: 'agent',
      agentId: 'agent-1',
      prompt: 'Explain {{text}}',
      selectedText: 'ubiquity',
      sessionId: 'open-3'
    }
    await act(async () => {
      render(<SelectionAgentWindow />)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('database is locked')

    MockDataApiUtils.setCustomResponse('/agent-sessions', 'POST', { id: 'retried-session' })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /common.retry/ })))

    expect(conversationProps().sessionId).toBe('retried-session')
  })

  it('ignores a draft that is blank once trimmed', async () => {
    mocks.action = ASK_AGENT
    render(<SelectionAgentWindow />)

    await act(async () => mocks.composeSend?.({ text: '\n \n', tokens: [] }))

    expect(requestsTo('ai.agent.assistant_session.create')).toHaveLength(0)
  })

  describe('state rules', () => {
    const CUSTOM_AGENT_ACTION: SelectionActionSession = {
      id: 'user-1',
      name: 'Vocabulary',
      enabled: true,
      isBuiltIn: false,
      runner: 'agent',
      agentId: 'agent-1',
      prompt: 'Explain {{text}}',
      selectedText: 'ubiquity',
      sessionId: 'open-4'
    }
    const closeRequests = () => requestsTo('window.close').length
    const lastReplaceable = () => requestsTo('selection.set_agent_window_replaceable').at(-1)?.[1]
    const pressEscape = ({ handled = false, isComposing = false } = {}) => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, isComposing })
      // A popover, the quick panel, or an approval prompt took the key before it reached the window.
      if (handled) event.preventDefault()
      act(() => void window.dispatchEvent(event))
    }

    beforeEach(() => {
      MockUsePreferenceUtils.setPreferenceValue('feature.selection.auto_close', true)
      MockUsePreferenceUtils.setPreferenceValue('feature.selection.auto_pin', false)
    })

    it('closes an empty compose bar on blur and keeps one holding an instruction', () => {
      mocks.action = ASK_AGENT
      render(<SelectionAgentWindow />)

      act(() => mocks.composeType?.('Why does this throw?'))
      fireEvent.blur(window)
      expect(closeRequests()).toBe(0)

      act(() => mocks.composeType?.('  '))
      fireEvent.blur(window)
      expect(closeRequests()).toBe(1)
    })

    it('ignores blur while pinned or with auto-close off', () => {
      mocks.action = ASK_AGENT
      MockUsePreferenceUtils.setPreferenceValue('feature.selection.auto_pin', true)
      const { unmount } = render(<SelectionAgentWindow />)
      fireEvent.blur(window)
      unmount()

      MockUsePreferenceUtils.setPreferenceValue('feature.selection.auto_pin', false)
      MockUsePreferenceUtils.setPreferenceValue('feature.selection.auto_close', false)
      render(<SelectionAgentWindow />)
      fireEvent.blur(window)

      expect(closeRequests()).toBe(0)
    })

    it('lets the next trigger replace it only while it is empty and unpinned', () => {
      mocks.action = ASK_AGENT
      const { unmount } = render(<SelectionAgentWindow />)
      expect(lastReplaceable()).toBe(true)

      act(() => mocks.composeType?.('Why?'))
      expect(lastReplaceable()).toBe(false)
      unmount()

      MockUsePreferenceUtils.setPreferenceValue('feature.selection.auto_pin', true)
      render(<SelectionAgentWindow />)
      expect(lastReplaceable()).toBe(false)
    })

    it('closes an empty compose bar on Esc unless something else handled the key', () => {
      mocks.action = ASK_AGENT
      render(<SelectionAgentWindow />)

      pressEscape({ isComposing: true })
      pressEscape({ handled: true })
      act(() => mocks.composeType?.('Why?'))
      pressEscape()
      expect(closeRequests()).toBe(0)

      act(() => mocks.composeType?.(''))
      pressEscape()
      expect(closeRequests()).toBe(1)
    })

    it('keeps a quote-only send open while its session is being created', () => {
      mocks.ipcRequest.mockImplementation((route: string) =>
        route === 'ai.agent.assistant_session.create' ? new Promise(() => undefined) : Promise.resolve()
      )
      mocks.action = ASK_AGENT
      render(<SelectionAgentWindow />)

      // The quote alone is a message, though the instruction the window tracks stays empty.
      act(() => mocks.composeSend?.({ text: '<blockquote>\n\nTypeError: x is undefined\n</blockquote>\n', tokens: [] }))
      fireEvent.blur(window)
      pressEscape()

      expect(closeRequests()).toBe(0)
      expect(lastReplaceable()).toBe(false)
    })

    it('keeps a starting custom action open, and closes one that failed to start', async () => {
      vi.mocked(dataApiService.post).mockReturnValueOnce(new Promise(() => undefined))
      mocks.action = CUSTOM_AGENT_ACTION
      const { unmount } = render(<SelectionAgentWindow />)
      fireEvent.blur(window)
      pressEscape()
      expect(closeRequests()).toBe(0)
      expect(lastReplaceable()).toBe(false)
      unmount()

      MockDataApiUtils.setErrorResponse('/agent-sessions', 'POST', new Error('database is locked'))
      await act(async () => {
        render(<SelectionAgentWindow />)
      })
      expect(lastReplaceable()).toBe(true)
      fireEvent.blur(window)
      expect(closeRequests()).toBe(1)
    })
  })
})
