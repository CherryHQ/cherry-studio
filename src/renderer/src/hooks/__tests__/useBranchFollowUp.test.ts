import type { Assistant, Topic } from '@renderer/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserMessage: vi.fn(),
  sendMessage: vi.fn(),
  dispatch: vi.fn()
}))

vi.mock('@renderer/services/MessagesService', () => ({
  getUserMessage: mocks.getUserMessage
}))

vi.mock('@renderer/store', () => ({
  useAppDispatch: () => mocks.dispatch
}))

vi.mock('@renderer/store/thunk/messageThunk', () => ({
  sendMessage: mocks.sendMessage
}))

import { useBranchFollowUp } from '../useBranchFollowUp'

const assistant: Assistant = {
  id: 'asst-real-1',
  name: 'Assistant',
  prompt: 'you are helpful.',
  topics: [{ id: 'topic-main', name: 'Main', assistantId: 'asst-real-1' } as Topic],
  type: 'assistant',
  emoji: ''
} as unknown as Assistant

// Two open branch topics, each carrying its hidden Mode-A system prompt.
const branchTopicA: Topic = {
  id: 'topic-branch-A',
  assistantId: 'asst-real-1',
  name: 'A',
  messages: [],
  prompt: 'SYSTEM-PROMPT-FOR-A'
} as unknown as Topic

const branchTopicB: Topic = {
  id: 'topic-branch-B',
  assistantId: 'asst-real-1',
  name: 'B',
  messages: [],
  prompt: 'SYSTEM-PROMPT-FOR-B'
} as unknown as Topic

describe('useBranchFollowUp (P1-S2b-2 per-card follow-up send)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserMessage.mockReturnValue({
      message: { id: 'user-msg-1' },
      blocks: [{ id: 'blk-user-1' }]
    })
    mocks.sendMessage.mockImplementation((...args: unknown[]) => ({ __thunk: 'sendMessage', args }))
  })

  it('dispatches sendMessage targeting the branch topic id it was given (routing)', () => {
    const { result } = renderHook(() => useBranchFollowUp({ assistant }))

    act(() => {
      result.current.send(branchTopicB, 'follow-up to B')
    })

    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
    const sendArgs = mocks.sendMessage.mock.calls[0]
    const passedTopicId = sendArgs[3] as string
    expect(passedTopicId).toBe('topic-branch-B')
  })

  it('routes to the SPECIFIC topic passed — sending to A targets A, not B (no global "active" branch)', () => {
    const { result } = renderHook(() => useBranchFollowUp({ assistant }))

    act(() => {
      result.current.send(branchTopicA, 'follow-up to A')
    })

    expect(mocks.sendMessage.mock.calls[0][3]).toBe('topic-branch-A')
    expect(mocks.sendMessage.mock.calls[0][3]).not.toBe('topic-branch-B')
  })

  it('passes a synthetic assistant whose .topics carries THIS branch topic (so messageThunk:853 re-injects its prompt on turn 2)', () => {
    const { result } = renderHook(() => useBranchFollowUp({ assistant }))

    act(() => {
      result.current.send(branchTopicB, 'follow up')
    })

    const passedAssistant = mocks.sendMessage.mock.calls[0][2] as Assistant
    const branchInTopics = passedAssistant.topics.find((t) => t.id === 'topic-branch-B')
    expect(branchInTopics).toBeDefined()
    // The object messageThunk:853 will .find() back MUST be the one carrying
    // the hidden system prompt — else the model goes context-blind on turn 2.
    expect(branchInTopics?.prompt).toBe('SYSTEM-PROMPT-FOR-B')
    // The main assistant id is preserved (BranchAssistantContext strict-match
    // depends on it) and the source topic is not dropped.
    expect(passedAssistant.id).toBe('asst-real-1')
    expect(passedAssistant.topics.find((t) => t.id === 'topic-main')).toBeDefined()
  })

  it('uses the raw follow-up as the user message content, bound to the branch topic', () => {
    const { result } = renderHook(() => useBranchFollowUp({ assistant }))

    act(() => {
      result.current.send(branchTopicB, '  what about edge cases?  ')
    })

    const userMessageArgs = mocks.getUserMessage.mock.calls[0][0]
    expect(userMessageArgs.content).toBe('what about edge cases?')
    expect(userMessageArgs.topic.id).toBe('topic-branch-B')
  })

  it('does not dispatch when the follow-up is empty / whitespace-only (defensive guard)', () => {
    const { result } = renderHook(() => useBranchFollowUp({ assistant }))

    act(() => {
      result.current.send(branchTopicB, '   \n\t ')
    })

    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })
})
