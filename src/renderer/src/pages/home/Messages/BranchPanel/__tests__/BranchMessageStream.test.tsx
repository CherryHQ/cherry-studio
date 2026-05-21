import type { Topic } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import type * as ReactI18nextModule from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useTopicMessages: vi.fn(),
  MessageGroup: vi.fn()
}))

vi.mock('@renderer/hooks/useMessageOperations', () => ({
  useTopicMessages: mocks.useTopicMessages
}))

vi.mock('../../MessageGroup', () => ({
  default: (props: { messages: unknown[]; topic: Topic }) => {
    mocks.MessageGroup(props)
    return <div data-testid="message-group" data-topic-id={props.topic.id} data-message-count={props.messages.length} />
  }
}))

// BranchMessageStream transitively imports MessageGroup → useTopic → i18n/index,
// which calls `i18n.use(initReactI18next).init(...)` at module load. Partial-mock
// react-i18next so initReactI18next stays real while useTranslation is stubbed.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof ReactI18nextModule>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

import BranchMessageStream from '../BranchMessageStream'

const branchTopic: Topic = {
  id: 'topic-branch-1',
  assistantId: 'asst-1',
  name: 'branch',
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
  messages: []
}

const mainTopic: Topic = {
  id: 'topic-main-9',
  assistantId: 'asst-1',
  name: 'main',
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
  messages: []
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('BranchMessageStream (T-006D-2B Gate #3 — branch isolation)', () => {
  beforeEach(() => {
    mocks.useTopicMessages.mockImplementation((topicId: string) => {
      // The whole point of this test: branch panel must read from
      // `messageIdsByTopic[branchTopic.id]`, NOT from `mainTopic.id`. We
      // simulate Redux by gating message lookup on topicId.
      if (topicId === 'topic-branch-1') {
        return [
          { id: 'br-user-1', role: 'user', topicId: 'topic-branch-1' },
          { id: 'br-asst-1', role: 'assistant', topicId: 'topic-branch-1', askId: 'br-user-1' }
        ]
      }
      if (topicId === 'topic-main-9') {
        return [
          { id: 'main-user-1', role: 'user', topicId: 'topic-main-9' },
          { id: 'main-asst-1', role: 'assistant', topicId: 'topic-main-9', askId: 'main-user-1' }
        ]
      }
      return []
    })
  })

  it('renders the empty-state placeholder when the branch topic has no messages', () => {
    mocks.useTopicMessages.mockReturnValueOnce([])
    render(<BranchMessageStream topic={branchTopic} />)

    expect(screen.getByTestId('branch-stream-empty')).toHaveTextContent('chat.message.anchor.panel.empty_stream')
    expect(screen.queryByTestId('message-group')).toBeNull()
  })

  it('useTopicMessages is called with the BRANCH topic id (not the main topic id)', () => {
    render(<BranchMessageStream topic={branchTopic} />)

    expect(mocks.useTopicMessages).toHaveBeenCalledWith('topic-branch-1')
    expect(mocks.useTopicMessages).not.toHaveBeenCalledWith('topic-main-9')
  })

  it("does NOT bleed the main topic's messages into the branch panel", () => {
    render(<BranchMessageStream topic={branchTopic} />)

    // MessageGroup is invoked once per group; assert every invocation was
    // bound to the branch topic, not the main topic.
    expect(mocks.MessageGroup).toHaveBeenCalled()
    for (const call of mocks.MessageGroup.mock.calls) {
      const props = call[0] as { topic: Topic; messages: Array<{ topicId: string }> }
      expect(props.topic.id).toBe('topic-branch-1')
      for (const m of props.messages) {
        expect(m.topicId).toBe('topic-branch-1')
      }
    }
  })

  it('renders each grouped message via MessageGroup and labels the rendered group with the branch topic id', () => {
    render(<BranchMessageStream topic={branchTopic} />)

    // Two messages → two groups (user grouped by self id; assistant grouped by
    // askId — see getGroupedMessages). Render order isn't asserted; only the
    // topic binding + total presence.
    const groups = screen.getAllByTestId('message-group')
    expect(groups.length).toBeGreaterThanOrEqual(1)
    for (const g of groups) {
      expect(g.getAttribute('data-topic-id')).toBe('topic-branch-1')
    }
  })

  it('mounting BranchMessageStream for the BRANCH does not subscribe useTopicMessages for the MAIN topic', () => {
    // Renders only branch — main-topic selector must not be queried.
    render(<BranchMessageStream topic={branchTopic} />)
    const calledTopics = mocks.useTopicMessages.mock.calls.map((c) => c[0])
    expect(calledTopics).toEqual(['topic-branch-1'])
    expect(calledTopics).not.toContain('topic-main-9')
    // sanity: mainTopic exists in fixture but we only render the branch
    expect(mainTopic.id).toBe('topic-main-9')
  })
})
