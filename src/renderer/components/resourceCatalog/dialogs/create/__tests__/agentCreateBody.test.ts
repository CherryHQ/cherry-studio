import type { UniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { buildAgentCreateBody } from '../agentCreateBody'
import type { ResourceCreateWizardValues } from '../types'

function values(overrides: Partial<ResourceCreateWizardValues> = {}): ResourceCreateWizardValues {
  return {
    avatar: '🤖',
    name: 'Agent',
    agentType: 'claude-code',
    modelId: 'openai::gpt-4o' as UniqueModelId,
    description: 'desc',
    prompt: 'be helpful',
    knowledgeBaseIds: [],
    skillIds: [],
    ...overrides
  }
}

describe('buildAgentCreateBody', () => {
  it('ships plan/small-model tiers for claude-code', () => {
    const body = buildAgentCreateBody(values({ agentType: 'claude-code' }))

    expect(body.type).toBe('claude-code')
    expect(body.planModel).toBe('openai::gpt-4o')
    expect(body.smallModel).toBe('openai::gpt-4o')
    expect(body.configuration?.permission_mode).toBe('bypassPermissions')
  })

  it('omits Claude-only defaults and ignored skills for pi and starts gated (D8)', () => {
    const body = buildAgentCreateBody(values({ agentType: 'pi', skillIds: ['skill-1'] }))

    expect(body.type).toBe('pi')
    expect(body.planModel).toBeUndefined()
    expect(body.smallModel).toBeUndefined()
    expect(body.skillIds).toBeUndefined()
    expect(body.configuration?.soul_enabled).toBeUndefined()
    expect(body.configuration?.permission_mode).toBe('default')
    expect(body.model).toBe('openai::gpt-4o')
  })
})
