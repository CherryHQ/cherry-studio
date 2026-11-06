import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { Provider } from '@shared/data/types/provider'

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: () => ({}) }
}))
vi.mock('@main/utils/binaryResolver', () => ({ getBinaryPath: async () => '/bun' }))
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: async () => ({}), refreshShellEnv: async () => ({}) }))

const { buildEnvironment } = await import('../environment')

const provider = { id: 'test' } as Provider
const agent = { id: 'agent', name: 'Agent', model: 'test::model' } as unknown as AgentEntity

describe('buildEnvironment API retries', () => {
  it('defaults to three retries', async () => {
    const env = await buildEnvironment(provider, agent)
    expect(env.CLAUDE_CODE_MAX_RETRIES).toBe('3')
  })

  it('allows an Agent to override the retry limit', async () => {
    const env = await buildEnvironment(provider, {
      ...agent,
      configuration: { env_vars: { CLAUDE_CODE_MAX_RETRIES: '0' } }
    })
    expect(env.CLAUDE_CODE_MAX_RETRIES).toBe('0')
  })
})
