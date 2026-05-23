import type { BranchAnchor } from '@renderer/pages/home/Messages/BranchPanel'
import type { Assistant, Topic } from '@renderer/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  createTopicTrigger: vi.fn(),
  getUserMessage: vi.fn(),
  sendMessage: vi.fn(),
  dispatch: vi.fn(),
  selectMessagesForTopic: vi.fn(),
  getMainTextContent: vi.fn(),
  storeGetState: vi.fn()
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: mocks.useMutation
}))

vi.mock('@renderer/services/MessagesService', () => ({
  getUserMessage: mocks.getUserMessage
}))

vi.mock('@renderer/store', () => ({
  default: { getState: mocks.storeGetState },
  useAppDispatch: () => mocks.dispatch
}))

vi.mock('@renderer/store/newMessage', () => ({
  selectMessagesForTopic: mocks.selectMessagesForTopic
}))

vi.mock('@renderer/store/thunk/messageThunk', () => ({
  sendMessage: mocks.sendMessage
}))

vi.mock('@renderer/utils/messageUtils/find', () => ({
  getMainTextContent: mocks.getMainTextContent
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { useBranchFork } from '../useBranchFork'

const assistant: Assistant = {
  id: 'asst-real-1',
  name: 'Assistant',
  prompt: 'you are helpful.',
  topics: [{ id: 'topic-main', name: 'Main', assistantId: 'asst-real-1' } as Topic],
  type: 'assistant',
  emoji: ''
} as unknown as Assistant

const sourceTopic: Topic = assistant.topics[0]

const anchor: BranchAnchor = {
  messageId: 'msg-source-1',
  blockId: 'blk-1',
  selectedText: 'distillation transfers knowledge from a teacher to a student',
  selectionStart: 0,
  selectionEnd: 60
}

const serverTopicShape = {
  id: 'topic-new-1',
  assistantId: 'asst-real-1',
  name: 'distillation transfers knowled',
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z'
}

describe('useBranchFork (T-006D-2B side-by-side)', () => {
  let onCreated: ReturnType<typeof vi.fn>
  let onSuccess: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    onCreated = vi.fn()
    onSuccess = vi.fn()

    mocks.useMutation.mockReturnValue({
      trigger: mocks.createTopicTrigger,
      isLoading: false,
      error: undefined
    })
    mocks.getUserMessage.mockReturnValue({
      message: { id: 'user-msg-1' },
      blocks: [{ id: 'blk-user-1' }]
    })
    mocks.sendMessage.mockImplementation((...args: unknown[]) => ({ __thunk: 'sendMessage', args }))
    // Default: source topic has one user message → mainGoal extracted
    mocks.selectMessagesForTopic.mockReturnValue([{ id: 'main-user-1', role: 'user', topicId: 'topic-main' }])
    mocks.getMainTextContent.mockReturnValue('how do I compress models for mobile?')
    mocks.storeGetState.mockReturnValue({})
  })

  it('success path: user message body is the raw follow-up (NOT the wrapped template)', async () => {
    mocks.createTopicTrigger.mockResolvedValue(serverTopicShape)

    const { result } = renderHook(() => useBranchFork({ assistant, topic: sourceTopic, onCreated, onSuccess }))

    await act(async () => {
      await result.current.fork(anchor, 'what is a student model?')
    })

    const userMessageCall = mocks.getUserMessage.mock.calls[0][0]
    expect(userMessageCall.content).toBe('what is a student model?')
    // Must NOT contain the system-prompt template anywhere in the user message
    expect(userMessageCall.content).not.toContain('展开的分支讨论')
    expect(userMessageCall.content).not.toContain('【用户在助手回复中选中的内容】')
  })

  it('passes a synthetic assistant to sendMessage with branch topic.prompt set (Mode A — messageThunk:855 hook)', async () => {
    mocks.createTopicTrigger.mockResolvedValue(serverTopicShape)

    const { result } = renderHook(() => useBranchFork({ assistant, topic: sourceTopic, onCreated, onSuccess }))

    await act(async () => {
      await result.current.fork(anchor, 'follow up')
    })

    const sendMessageArgs = mocks.sendMessage.mock.calls[0]
    const passedAssistant = sendMessageArgs[2] as Assistant
    const passedTopicId = sendMessageArgs[3] as string

    expect(passedTopicId).toBe('topic-new-1')

    // Synthetic assistant.topics MUST include the branch topic AND
    // the original source topic. (Source topic stays because messageThunk
    // looks up topic.prompt by topicId — we only need the branch topic
    // for messageThunk:854, but the source topic must remain untouched.)
    const branchInTopics = passedAssistant.topics.find((t) => t.id === 'topic-new-1')
    expect(branchInTopics).toBeDefined()
    expect(branchInTopics?.prompt).toBeDefined()
    expect(branchInTopics?.prompt).toContain('distillation transfers knowledge from a teacher to a student')
    expect(branchInTopics?.prompt).toContain('how do I compress models for mobile?')
    expect(branchInTopics?.prompt).toContain('【用户在助手回复中选中的内容】')

    // Silent-killer guard: the object reference messageThunk:854 will .find()
    // back MUST be the same one carrying the prompt we just built.
    const expectedReference = passedAssistant.topics.at(-1)
    expect(expectedReference?.id).toBe('topic-new-1')
    expect(expectedReference?.prompt).toBe(branchInTopics?.prompt)
  })

  it('does NOT dispatch into Redux assistants.topics (sidebar stays clean)', async () => {
    mocks.createTopicTrigger.mockResolvedValue(serverTopicShape)

    const { result } = renderHook(() => useBranchFork({ assistant, topic: sourceTopic, onCreated, onSuccess }))

    await act(async () => {
      await result.current.fork(anchor, 'follow up')
    })

    // Only one dispatch — the sendMessage thunk. NO addTopic, NO removeTopic.
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ __thunk: 'sendMessage' }))
  })

  it('invokes onCreated with the renderer branch topic (id + prompt)', async () => {
    mocks.createTopicTrigger.mockResolvedValue(serverTopicShape)

    const { result } = renderHook(() => useBranchFork({ assistant, topic: sourceTopic, onCreated, onSuccess }))

    await act(async () => {
      await result.current.fork(anchor, 'follow up')
    })

    expect(onCreated).toHaveBeenCalledTimes(1)
    const createdTopic = onCreated.mock.calls[0][0] as Topic
    expect(createdTopic.id).toBe('topic-new-1')
    expect(createdTopic.messages).toEqual([])
    expect(createdTopic.prompt).toBeDefined()
    expect(createdTopic.prompt).toContain('distillation transfers knowledge')
  })

  it('omits the main-goal section when source topic has no user message', async () => {
    mocks.createTopicTrigger.mockResolvedValue(serverTopicShape)
    mocks.selectMessagesForTopic.mockReturnValue([]) // empty source topic
    mocks.getMainTextContent.mockReturnValue('')

    const { result } = renderHook(() => useBranchFork({ assistant, topic: sourceTopic, onCreated, onSuccess }))

    await act(async () => {
      await result.current.fork(anchor, 'follow up')
    })

    const passedAssistant = mocks.sendMessage.mock.calls[0][2] as Assistant
    const branch = passedAssistant.topics.find((t) => t.id === 'topic-new-1')
    expect(branch?.prompt).not.toContain('【主对话的总目标')
    expect(branch?.prompt).toContain('【用户在助手回复中选中的内容】')
  })

  it("omits assistantId in CreateTopicDto when assistant.id is the legacy 'default' sentinel", async () => {
    mocks.createTopicTrigger.mockResolvedValue(serverTopicShape)

    const defaultAssistant = { ...assistant, id: 'default' } as Assistant
    const { result } = renderHook(() =>
      useBranchFork({ assistant: defaultAssistant, topic: sourceTopic, onCreated, onSuccess })
    )

    await act(async () => {
      await result.current.fork(anchor, 'follow up')
    })

    const body = mocks.createTopicTrigger.mock.calls[0][0].body
    expect(body).not.toHaveProperty('assistantId')
    expect(body).toMatchObject({ sourceNodeId: 'msg-source-1' })
  })

  it('createTopic failure: status=error, downstream sendMessage + onCreated skipped', async () => {
    mocks.createTopicTrigger.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useBranchFork({ assistant, topic: sourceTopic, onCreated, onSuccess }))

    await act(async () => {
      await result.current.fork(anchor, 'follow up')
    })

    expect(result.current.status).toBe('error')
    expect(result.current.errorMessage).toBe('chat.message.anchor.panel.error.create_failed')
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('reset() clears error state back to idle', async () => {
    mocks.createTopicTrigger.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useBranchFork({ assistant, topic: sourceTopic, onCreated, onSuccess }))

    await act(async () => {
      await result.current.fork(anchor, 'follow up')
    })
    expect(result.current.status).toBe('error')

    act(() => {
      result.current.reset()
    })

    await waitFor(() => {
      expect(result.current.status).toBe('idle')
      expect(result.current.errorMessage).toBeUndefined()
    })
  })

  it('falls back to "Branch" topic name when selectedText trims to empty', async () => {
    mocks.createTopicTrigger.mockResolvedValue(serverTopicShape)
    const emptySelectionAnchor: BranchAnchor = { ...anchor, selectedText: '   \n\t  ' }

    const { result } = renderHook(() => useBranchFork({ assistant, topic: sourceTopic, onCreated, onSuccess }))

    await act(async () => {
      await result.current.fork(emptySelectionAnchor, 'follow up')
    })

    expect(mocks.createTopicTrigger.mock.calls[0][0].body.name).toBe('Branch')
  })
})
