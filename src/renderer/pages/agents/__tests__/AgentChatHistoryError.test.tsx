import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FileEditSessionProvider } from '@renderer/components/FileEditSessionProvider'
import type { useAgentSessionParts } from '@renderer/hooks/useAgentSessionParts'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { CherryUIMessage } from '@shared/data/types/message'

import AgentChat from '../AgentChat'

const mocks = vi.hoisted(() => ({
  history: new Map<string, ReturnType<typeof useAgentSessionParts>>(),
  send: vi.fn<(message?: { text: string }, options?: unknown) => Promise<boolean>>(async () => true),
  stop: vi.fn(async () => {})
}))

vi.mock('@cherrystudio/ui', (importOriginal) => importOriginal())
vi.mock('@renderer/hooks/useAgentSessionParts', () => ({
  useAgentSessionParts: (sessionId: string) => mocks.history.get(sessionId)
}))
vi.mock('@renderer/hooks/useChatWithHistory', () => ({
  useChatWithHistory: () => ({ activeExecutions: [], setMessages: vi.fn(), stop: mocks.stop })
}))
vi.mock('@renderer/hooks/useExecutionOverlay', () => ({
  useExecutionOverlay: () => ({ overlay: {}, liveAssistants: [], disposeOverlay: vi.fn(), reset: vi.fn() })
}))
vi.mock('@renderer/hooks/useTopicStreamStatus', () => ({
  useTopicStreamStatus: () => ({ isPending: false }),
  useTopicOverlayHandoffOnTerminal: () => {}
}))
vi.mock('@renderer/hooks/useConversationTurnController', () => ({
  useConversationTurnController: () => ({ send: mocks.send })
}))
vi.mock('@renderer/components/chat/shell/ConversationShell', () => ({
  default: ({ center }: { center: ReactNode }) => <>{center}</>
}))
vi.mock('@renderer/components/composer/ComposerDockTransitionFrame', () => ({
  default: ({ main, composer }: { main: ReactNode; composer: ReactNode }) => (
    <>
      {main}
      {composer}
    </>
  )
}))
vi.mock('../components/AgentChatNavbar', () => ({ AgentChatNavbar: () => null }))
vi.mock('../components/AgentRightPane', () => ({
  AgentRightPane: {
    Scope: ({ children }: PropsWithChildren) => children,
    Shortcuts: () => null,
    Viewport: () => null
  },
  AgentTaskProgressCapsule: () => null,
  useAgentRightPaneActions: () => ({}),
  useOptionalAgentRightPaneActions: () => undefined
}))
vi.mock('../components/AgentSessionMessages', () => ({
  default: ({ messages }: { messages: CherryUIMessage[] }) => (
    <section aria-label="History">
      {messages.map((message) => (
        <article key={message.id}>
          {message.parts.map((part, index) => (part.type === 'text' ? <p key={index}>{part.text}</p> : null))}
        </article>
      ))}
    </section>
  )
}))
vi.mock('@renderer/components/composer/ComposerCore', () => ({
  default: ({ fallback }: { fallback: ReactNode }) => fallback
}))
vi.mock('@renderer/components/composer/variants/AgentComposer', () => ({
  default: ({ sendDisabled, sendMessage }: { sendDisabled?: boolean; sendMessage: typeof mocks.send }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const text = new FormData(event.currentTarget).get('message') as string
        void sendMessage({ text })
      }}>
      <textarea name="message" aria-label="Message" disabled={sendDisabled} />
      <button type="submit" disabled={sendDisabled}>
        Send
      </button>
    </form>
  ),
  MissingAgentHomeComposer: () => null
}))

const readFailures = [
  {
    reason: 'AGENT_SESSION_MESSAGE_READ_BUDGET_EXCEEDED',
    message: 'Message history read exceeds the safety limit'
  },
  {
    reason: 'AGENT_SESSION_MESSAGE_READ_ALLOCATION_FAILED',
    message: 'Message history read failed to allocate memory safely'
  }
] as const

function history(error?: Error, messages: CherryUIMessage[] = []): ReturnType<typeof useAgentSessionParts> {
  return {
    error,
    messages,
    getMessageSiblings: () => null,
    setActiveBranch: vi.fn(),
    persistedPartsByMessageId: {},
    isLoading: false,
    hasOlder: false,
    loadOlder: vi.fn(),
    selectAllPagination: { hasOlder: false, isLoading: false, start: vi.fn(), stop: vi.fn() },
    refresh: vi.fn(async () => messages),
    seedReservedMessages: vi.fn(),
    replaceMessageTail: vi.fn(),
    deleteMessage: vi.fn()
  }
}

function readError(failure: (typeof readFailures)[number] = readFailures[0]): DataApiError {
  return new DataApiError(ErrorCode.INVALID_OPERATION, failure.message, 400, {
    operation: 'listSessionMessages',
    reason: failure.reason
  })
}

function bootstrap(sessionId = 'session-1'): ComponentProps<typeof AgentChat>['conversationBootstrap'] {
  return {
    session: { id: sessionId, agentId: 'agent-1' } as NonNullable<
      ComponentProps<typeof AgentChat>['conversationBootstrap']['session']
    >,
    sessionLoading: false,
    sessionSource: 'query',
    resources: {
      agent: {
        id: 'agent-1',
        type: 'pi',
        configuration: {}
      } as NonNullable<ComponentProps<typeof AgentChat>['conversationBootstrap']['resources']['agent']>,
      agentLoading: false,
      model: undefined,
      modelLoading: false
    }
  }
}

describe('AgentChat history read errors', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
    MockUseDataApiUtils.resetMocks()
    mocks.history.clear()
    await i18n.changeLanguage('en-us')
  })

  it.each(readFailures)('shows $reason without the empty conversation greeting', (failure) => {
    mocks.history.set('session-1', history(readError(failure)))
    render(<AgentChat conversationBootstrap={bootstrap()} />, { wrapper: FileEditSessionProvider })

    expect(screen.getByRole('alert')).toHaveTextContent(failure.message)
    expect(within(screen.getByRole('alert')).getByText(i18n.t('common.error'))).toBeVisible()
    expect(screen.queryByText(i18n.t('agent.home.welcome_title'))).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('keeps loaded history and the composer usable when an older page fails', async () => {
    const user = userEvent.setup()
    mocks.history.set(
      'session-1',
      history(readError(), [{ id: 'loaded-message', role: 'user', parts: [{ type: 'text', text: 'Loaded history' }] }])
    )
    render(<AgentChat conversationBootstrap={bootstrap()} />, { wrapper: FileEditSessionProvider })

    expect(screen.getByRole('alert')).toHaveTextContent(readFailures[0].message)
    expect(within(screen.getByRole('region', { name: 'History' })).getByText('Loaded history')).toBeVisible()
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Continue working')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(mocks.send).toHaveBeenCalledWith({ text: 'Continue working', options: undefined })
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('clears the previous history error after switching to a healthy session', () => {
    mocks.history.set('session-1', history(readError()))
    mocks.history.set('session-2', history())
    const { rerender } = render(<AgentChat conversationBootstrap={bootstrap()} />, {
      wrapper: FileEditSessionProvider
    })
    expect(screen.getByRole('alert')).toHaveTextContent(readFailures[0].message)

    rerender(<AgentChat conversationBootstrap={bootstrap('session-2')} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('agent.home.welcome_title'))).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled()
  })
})
