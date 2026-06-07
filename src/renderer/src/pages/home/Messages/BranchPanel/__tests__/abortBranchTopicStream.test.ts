import { beforeEach, describe, expect, it, vi } from 'vitest'

// A real Map stands in for the production abortMap so tests can register/clear
// live abort controllers per case. abortCompletion is a spy.
const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  selectMessagesForTopic: vi.fn(),
  abortCompletion: vi.fn(),
  abortMap: new Map<string, (() => void)[]>()
}))

vi.mock('@renderer/store', () => ({ default: { getState: mocks.getState } }))
vi.mock('@renderer/store/newMessage', () => ({ selectMessagesForTopic: mocks.selectMessagesForTopic }))
vi.mock('@renderer/utils/abortController', () => ({
  abortCompletion: mocks.abortCompletion,
  abortMap: mocks.abortMap
}))

import { abortBranchTopicStream } from '../abortBranchTopicStream'

const STATE = { messages: {} }

/** Register a live abort controller under `askId` (mirrors addAbortController). */
const registerLive = (askId: string) => mocks.abortMap.set(askId, [() => {}])

beforeEach(() => {
  vi.clearAllMocks()
  mocks.abortMap.clear()
  mocks.getState.mockReturnValue(STATE)
})

describe('abortBranchTopicStream (P1-B5 abort-on-close + P1-S3 abortMap targeting)', () => {
  // ── The falsifiable core: a message can already be status:'success' while its
  //    stream is still open; its abortController is still live in abortMap. The
  //    old status filter (processing|pending) misses it; targeting by abortMap
  //    presence catches it. Mutation: revert the target to a status filter and
  //    THIS test goes red.
  it('aborts a status:"success" reply whose abortController is still live in abortMap', () => {
    registerLive('u1')
    mocks.selectMessagesForTopic.mockReturnValue([
      { id: 'u1', role: 'user', status: 'success', askId: undefined },
      { id: 'a1', role: 'assistant', status: 'success', askId: 'u1' } // premature success, still streaming
    ])

    const aborted = abortBranchTopicStream('topic-branch-X')

    expect(mocks.selectMessagesForTopic).toHaveBeenCalledWith(STATE, 'topic-branch-X')
    expect(mocks.abortCompletion).toHaveBeenCalledExactlyOnceWith('u1')
    // Returns the aborted assistant message id (delete-after-settle waits on it).
    expect(aborted).toEqual(['a1'])
  })

  it('aborts an in-flight (processing) reply whose controller is live', () => {
    registerLive('u1')
    mocks.selectMessagesForTopic.mockReturnValue([
      { id: 'u1', role: 'user', status: 'success', askId: undefined },
      { id: 'a1', role: 'assistant', status: 'processing', askId: 'u1' }
    ])

    expect(abortBranchTopicStream('topic-branch-X')).toEqual(['a1'])
    expect(mocks.abortCompletion).toHaveBeenCalledExactlyOnceWith('u1')
  })

  it('NEGATIVE: an assistant message with NO live controller in abortMap aborts nothing, returns []', () => {
    // abortMap empty → even a 'processing' message is not targeted (no controller to fire).
    mocks.selectMessagesForTopic.mockReturnValue([
      { id: 'u1', role: 'user', status: 'success', askId: undefined },
      { id: 'a1', role: 'assistant', status: 'processing', askId: 'u1' }
    ])
    expect(abortBranchTopicStream('t')).toEqual([])
    expect(mocks.abortCompletion).not.toHaveBeenCalled()
  })

  it('does NOT abort user messages even if some askId collides in abortMap', () => {
    registerLive('u1')
    mocks.selectMessagesForTopic.mockReturnValue([
      { id: 'u1', role: 'user', status: 'success', askId: 'u1' } // user role excluded
    ])
    expect(abortBranchTopicStream('t')).toEqual([])
    expect(mocks.abortCompletion).not.toHaveBeenCalled()
  })

  it('no messages / empty topic → no abort', () => {
    registerLive('u1')
    mocks.selectMessagesForTopic.mockReturnValue([])
    abortBranchTopicStream('t')
    expect(mocks.abortCompletion).not.toHaveBeenCalled()

    mocks.selectMessagesForTopic.mockReturnValue(undefined)
    abortBranchTopicStream('t')
    expect(mocks.abortCompletion).not.toHaveBeenCalled()
  })

  it('dedups: two assistant messages sharing one live askId → abortCompletion called once', () => {
    registerLive('u1')
    mocks.selectMessagesForTopic.mockReturnValue([
      { id: 'a1', role: 'assistant', status: 'success', askId: 'u1' },
      { id: 'a2', role: 'assistant', status: 'processing', askId: 'u1' }
    ])
    expect(abortBranchTopicStream('t')).toEqual(['a1', 'a2'])
    expect(mocks.abortCompletion).toHaveBeenCalledExactlyOnceWith('u1')
  })

  it('only targets the assistant messages whose controller is live (mixed live/stale)', () => {
    registerLive('u2') // only the second reply's controller is live
    mocks.selectMessagesForTopic.mockReturnValue([
      { id: 'a1', role: 'assistant', status: 'success', askId: 'u1' }, // controller already gone
      { id: 'a2', role: 'assistant', status: 'success', askId: 'u2' } // still live
    ])
    expect(abortBranchTopicStream('t')).toEqual(['a2'])
    expect(mocks.abortCompletion).toHaveBeenCalledExactlyOnceWith('u2')
  })
})
