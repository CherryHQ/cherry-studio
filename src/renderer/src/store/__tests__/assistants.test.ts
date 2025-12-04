import type { Assistant, Topic } from '@renderer/types'
import { vi } from 'vitest'

import type { AssistantsState } from '../assistants'

vi.mock('@renderer/utils', () => ({
  uuid: () => 'test-uuid'
}))

const makeTopic = (id: string, assistantId: string): Topic => ({
  id,
  assistantId,
  name: `topic-${id}`,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  messages: []
})

const makeAssistant = (id: string, topics: Topic[]): Assistant => ({
  id,
  name: `assistant-${id}`,
  prompt: '',
  topics,
  type: 'assistant'
})

describe('assistants reducer - moveAllTopics', () => {
  let assistantsReducer: any
  let moveAllTopics: any

  beforeAll(async () => {
    const mod = await import('../assistants')
    assistantsReducer = mod.default
    moveAllTopics = mod.moveAllTopics
  })

  const assistantA = makeAssistant('a', [makeTopic('t1', 'a'), makeTopic('t2', 'a')])
  const assistantB = makeAssistant('b', [makeTopic('t3', 'b')])

  const baseState: AssistantsState = {
    defaultAssistant: assistantA,
    assistants: [assistantA, assistantB],
    tagsOrder: [],
    collapsedTags: {},
    presets: [],
    unifiedListOrder: []
  }

  it('moves all topics from source to target and leaves a default topic', () => {
    const nextState = assistantsReducer(baseState, moveAllTopics({ fromId: 'a', toId: 'b' }))

    const from = nextState.assistants.find((a) => a.id === 'a')!
    const to = nextState.assistants.find((a) => a.id === 'b')!

    expect(from.topics).toHaveLength(1)
    expect(from.topics[0].assistantId).toBe('a')

    expect(to.topics.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    expect(to.topics.every((t) => t.assistantId === 'b')).toBe(true)

    expect(baseState.assistants[0].topics).toHaveLength(2)
    expect(baseState.assistants[1].topics).toHaveLength(1)
  })
})
