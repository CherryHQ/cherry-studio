import { render } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentSessionMessages from '../AgentSessionMessages'

const useAgentMessageListProviderValueMock = vi.hoisted(() => vi.fn(() => ({ state: {}, actions: {}, meta: {} })))
const ipcRequestMock = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)))
const ipcListenMock = vi.hoisted(() =>
  vi.fn<
    (
      event: string,
      listener: (event: { sessionId: string; info?: { resume: boolean }; restoreUnavailable?: boolean }) => void
    ) => () => void
  >(() => () => {})
)

vi.mock('@renderer/components/chat/messages/MessageList', () => ({
  default: () => <div data-testid="message-list" />
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  MessageListProvider: ({ children }: PropsWithChildren) => <div data-testid="message-list-provider">{children}</div>
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => ['anchor']
}))

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useSession: () => ({
    session: {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Agent session',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  })
}))

vi.mock('../../messages/agentMessageListAdapter', () => ({
  useAgentMessageListProviderValue: useAgentMessageListProviderValueMock
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock, on: ipcListenMock }
}))

describe('AgentSessionMessages', () => {
  beforeEach(() => {
    useAgentMessageListProviderValueMock.mockClear()
    ipcRequestMock.mockClear()
    ipcListenMock.mockClear()
  })

  it('normalizes blank agent avatars before passing the assistant profile to the message list', () => {
    render(
      <AgentSessionMessages
        agentId="agent-1"
        sessionId="session-1"
        messages={[]}
        activeAgent={{ id: 'agent-1', name: 'Blank avatar agent', configuration: { avatar: '   ' } } as any}
        partsByMessageId={{}}
        isLoading={false}
      />
    )

    expect(useAgentMessageListProviderValueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantProfile: expect.objectContaining({
          name: 'Blank avatar agent',
          avatar: '🤖'
        })
      })
    )
  })

  it('uses the active session workspace path for message actions', () => {
    render(
      <AgentSessionMessages
        agentId="agent-1"
        sessionId="session-1"
        workspacePath="/Users/alice/Data/Agents/agent-1/session-1"
        messages={[]}
        partsByMessageId={{}}
        isLoading={false}
      />
    )

    expect(useAgentMessageListProviderValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: '/Users/alice/Data/Agents/agent-1/session-1' })
    )
  })

  it('allows continuation of a local task even when the native thread cannot resume', () => {
    const checked = vi.fn()
    const view = render(
      <AgentSessionMessages
        agentId="local"
        sessionId="session-1"
        messages={[]}
        partsByMessageId={{}}
        isLoading={false}
        onLocalRestoreChecked={checked}
      />
    )
    const listener = ipcListenMock.mock.calls[0][1]
    expect(checked).toHaveBeenLastCalledWith(false)
    listener({ sessionId: 'session-1', info: { resume: false } })
    expect(checked).toHaveBeenLastCalledWith(false)
    listener({ sessionId: 'session-1', restoreUnavailable: true })
    expect(checked).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(ipcRequestMock).not.toHaveBeenCalled()
  })

  it('can mount and unmount a history view without issuing an execution command', () => {
    const view = render(
      <AgentSessionMessages
        agentId="agent-1"
        sessionId="session-1"
        messages={[]}
        partsByMessageId={{}}
        isLoading={false}
      />
    )

    view.unmount()
    expect(ipcRequestMock).not.toHaveBeenCalled()
  })
})
