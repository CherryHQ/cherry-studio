import { parseUniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { getAgentRuntimeExecutionId } from '../agentRuntimeIdentity'

describe('getAgentRuntimeExecutionId', () => {
  it('uses the configured model for local runtimes', () => {
    expect(getAgentRuntimeExecutionId({ id: 'agent-1', type: 'pi', model: 'openai::gpt-5' })).toBe('openai::gpt-5')
  })

  it('uses a valid model-shaped key containing only the local agent id for a model-free runtime', () => {
    const executionId = getAgentRuntimeExecutionId({ id: 'agent-1', type: 'stella', model: null })
    expect(executionId).toBe('agent-runtime::agent-1')
    expect(parseUniqueModelId(executionId!)).toEqual({ providerId: 'agent-runtime', modelId: 'agent-1' })
  })

  it('fails closed for an unknown model-free runtime', () => {
    expect(getAgentRuntimeExecutionId({ id: 'agent-1', type: 'unknown' as never, model: null })).toBeUndefined()
  })
})
