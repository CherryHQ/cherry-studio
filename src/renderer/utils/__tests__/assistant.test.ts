import {
  composeRuntimeDefaultAssistant,
  isRuntimeDefaultAssistantId,
  normalizeAssistantId
} from '@renderer/utils/assistant'
import { describe, expect, it } from 'vitest'

describe('assistant utils', () => {
  it('treats null as the runtime default assistant id', () => {
    expect(isRuntimeDefaultAssistantId(null)).toBe(true)
    expect(normalizeAssistantId(null)).toBeNull()
    expect(normalizeAssistantId(undefined)).toBeNull()
    expect(normalizeAssistantId('')).toBeNull()
  })

  it('composes only the runtime default assistant fields used by consumers', () => {
    const assistant = composeRuntimeDefaultAssistant('provider::model', (key) => key)

    expect(assistant).toMatchObject({
      id: null,
      emoji: '😀',
      modelId: 'provider::model'
    })
    expect(assistant.name).toBeTruthy()
    expect(Object.keys(assistant).sort()).toEqual(['emoji', 'id', 'modelId', 'name'])
    expect(isRuntimeDefaultAssistantId(assistant.id)).toBe(true)
    expect('settings' in assistant).toBe(false)
    expect('createdAt' in assistant).toBe(false)
  })
})
