import {
  composeRuntimeDefaultAssistant,
  isDefaultAssistantId,
  isPersistedAssistantRef,
  isRuntimeDefaultAssistant,
  isRuntimeDefaultAssistantRef,
  normalizeAssistantId,
  toAssistantRef
} from '@renderer/domain/assistant/runtimeDefaultAssistant'
import { describe, expect, it } from 'vitest'

describe('runtimeDefaultAssistant domain helpers', () => {
  it('treats null as the runtime default assistant id', () => {
    expect(isDefaultAssistantId(null)).toBe(true)
    expect(normalizeAssistantId(null)).toBeNull()
    expect(normalizeAssistantId(undefined)).toBeNull()
    expect(normalizeAssistantId('')).toBeNull()
  })

  it('treats a string id as a persisted assistant ref', () => {
    const ref = toAssistantRef('assistant-1')

    expect(isPersistedAssistantRef(ref)).toBe(true)
    expect(ref).toEqual({ kind: 'persisted', assistantId: 'assistant-1' })
  })

  it('returns a runtime default ref for null', () => {
    const ref = toAssistantRef(null)

    expect(isRuntimeDefaultAssistantRef(ref)).toBe(true)
    expect(ref).toEqual({ kind: 'default', assistantId: null })
  })

  it('composes the runtime default assistant without a persisted id', () => {
    const assistant = composeRuntimeDefaultAssistant('provider::model')

    expect(assistant.id).toBeNull()
    expect(assistant.modelId).toBe('provider::model')
    expect(isRuntimeDefaultAssistant(assistant)).toBe(true)
  })
})
