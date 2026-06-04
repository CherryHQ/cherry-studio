import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  selectMessagesForTopic: vi.fn(),
  abortCompletion: vi.fn()
}))

vi.mock('@renderer/store', () => ({ default: { getState: mocks.getState } }))
vi.mock('@renderer/store/newMessage', () => ({ selectMessagesForTopic: mocks.selectMessagesForTopic }))
vi.mock('@renderer/utils/abortController', () => ({ abortCompletion: mocks.abortCompletion }))

import { abortBranchTopicStream } from '../abortBranchTopicStream'

const STATE = { messages: {} }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getState.mockReturnValue(STATE)
})

describe('abortBranchTopicStream (P1-B5 abort-on-close)', () => {
  it('aborts the in-flight streaming reply: abortCompletion called with the streaming message askId', () => {
    mocks.selectMessagesForTopic.mockReturnValue([
      { id: 'u1', role: 'user', status: 'success', askId: undefined },
      { id: 'a1', role: 'assistant', status: 'processing', askId: 'u1' } // streaming
    ])

    abortBranchTopicStream('topic-branch-X')

    expect(mocks.selectMessagesForTopic).toHaveBeenCalledWith(STATE, 'topic-branch-X')
    expect(mocks.abortCompletion).toHaveBeenCalledExactlyOnceWith('u1')
  })

  it('also aborts a pending (not-yet-streaming) reply', () => {
    mocks.selectMessagesForTopic.mockReturnValue([{ id: 'a1', role: 'assistant', status: 'pending', askId: 'u9' }])
    abortBranchTopicStream('t')
    expect(mocks.abortCompletion).toHaveBeenCalledExactlyOnceWith('u9')
  })

  it('NEGATIVE: a non-streaming branch (all messages settled) aborts nothing', () => {
    mocks.selectMessagesForTopic.mockReturnValue([
      { id: 'u1', role: 'user', status: 'success', askId: undefined },
      { id: 'a1', role: 'assistant', status: 'success', askId: 'u1' }
    ])
    abortBranchTopicStream('t')
    expect(mocks.abortCompletion).not.toHaveBeenCalled()
  })

  it('no messages / empty topic → no abort', () => {
    mocks.selectMessagesForTopic.mockReturnValue([])
    abortBranchTopicStream('t')
    expect(mocks.abortCompletion).not.toHaveBeenCalled()

    mocks.selectMessagesForTopic.mockReturnValue(undefined)
    abortBranchTopicStream('t')
    expect(mocks.abortCompletion).not.toHaveBeenCalled()
  })

  it('dedups: two streaming messages sharing one askId → abortCompletion called once', () => {
    mocks.selectMessagesForTopic.mockReturnValue([
      { id: 'a1', role: 'assistant', status: 'processing', askId: 'u1' },
      { id: 'a2', role: 'assistant', status: 'processing', askId: 'u1' }
    ])
    abortBranchTopicStream('t')
    expect(mocks.abortCompletion).toHaveBeenCalledExactlyOnceWith('u1')
  })
})
