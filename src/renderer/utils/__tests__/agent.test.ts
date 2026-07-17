import { describe, expect, it } from 'vitest'

import { getAgentDescriptionForDisplay } from '../agent'

describe('agent utilities', () => {
  it('uses localized builtin Cherry Assistant description only when the stored description is empty', () => {
    const t = (key: string) => `translated:${key}`
    expect(
      getAgentDescriptionForDisplay(
        { description: '', configuration: { builtin_role: 'assistant' } },
        t as Parameters<typeof getAgentDescriptionForDisplay>[1]
      )
    ).toBe('translated:agent.builtin.cherry_assistant.description')
    expect(
      getAgentDescriptionForDisplay(
        { description: 'User description', configuration: { builtin_role: 'assistant' } },
        t as Parameters<typeof getAgentDescriptionForDisplay>[1]
      )
    ).toBe('User description')
  })
})
