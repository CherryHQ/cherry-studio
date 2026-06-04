import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => (key === 'chat.default.name' ? 'Default assistant' : key)
  }
}))

import { getDefaultAssistant } from '../AssistantService'

describe('AssistantService legacy default assistant shim', () => {
  it('keeps the v1 default assistant sentinel out of the runtime default id contract', () => {
    const assistant = getDefaultAssistant()

    expect(assistant.id).toBe('default')
    expect(assistant.name).toBe('Default assistant')
    expect(assistant.type).toBe('assistant')
    expect(assistant.topics).toEqual([])
  })
})
