import type { Assistant, Topic } from '@renderer/types'
import { describe, expect, it } from 'vitest'

import { resolveAssistantSource } from '../BranchAssistantContext'

// Minimal fixtures — `resolveAssistantSource` is structural and ignores
// everything except `id` and the reference identity.
const mainTopic: Topic = {
  id: 'topic-main',
  assistantId: 'asst-main',
  name: 'Main',
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
  messages: []
}

const branchTopic: Topic = {
  id: 'topic-branch',
  assistantId: 'asst-main',
  name: 'Branch',
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
  messages: [],
  prompt: 'BRANCH_SYSTEM_PROMPT'
}

const reduxAssistant = {
  id: 'asst-main',
  name: 'Main',
  prompt: 'you are helpful',
  topics: [mainTopic]
} as unknown as Assistant

const otherReduxAssistant = {
  id: 'asst-other',
  name: 'Other',
  prompt: '',
  topics: []
} as unknown as Assistant

const synthetic: Assistant = {
  ...reduxAssistant,
  topics: [mainTopic, branchTopic]
}

describe('resolveAssistantSource — T-006D-2B strict-match guardrail', () => {
  it('NO Provider (override = null): returns the Redux assistant unchanged — main-chat behaviour preserved', () => {
    const result = resolveAssistantSource('asst-main', reduxAssistant, null)
    expect(result).toBe(reduxAssistant)
    expect(result.topics).toHaveLength(1)
    expect(result.topics?.[0]?.id).toBe('topic-main')
  })

  it('Provider present + id strictly matches: returns the synthetic assistant (branch subtree path)', () => {
    const result = resolveAssistantSource('asst-main', reduxAssistant, { assistant: synthetic })
    expect(result).toBe(synthetic)
    expect(result.topics).toHaveLength(2)
    const branch = result.topics?.find((t) => t.id === 'topic-branch')
    expect(branch?.prompt).toBe('BRANCH_SYSTEM_PROMPT')
  })

  it('Provider present but id MISMATCH: falls through to Redux — branch-internal lookups for a different assistant unaffected', () => {
    // Synthetic in scope is for 'asst-main', but caller asks for 'asst-other'.
    // Even inside the branch subtree, this must not return the synthetic.
    const result = resolveAssistantSource('asst-other', otherReduxAssistant, { assistant: synthetic })
    expect(result).toBe(otherReduxAssistant)
    expect(result.topics).toEqual([])
  })

  it('Provider present but override.assistant.id is a stale id (mismatched against the synthetic itself)', () => {
    // Defensive: even if some caller wires a stale Provider value where the
    // synthetic's id doesn't match the requested id, do NOT swap.
    const staleSynthetic: Assistant = { ...synthetic, id: 'asst-stale' }
    const result = resolveAssistantSource('asst-main', reduxAssistant, { assistant: staleSynthetic })
    expect(result).toBe(reduxAssistant)
  })
})
