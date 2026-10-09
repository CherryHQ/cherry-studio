import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '1.9.99-test' } }))

import { buildEnvironment } from '../environment'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { Provider } from '@shared/data/types/provider'

vi.mock('@application', () => ({
  application: { getPath: vi.fn(() => '/fake/path') }
}))
vi.mock('@data/services/ModelService', () => ({
  modelService: {
    getModelByUniqueModelId: vi.fn(() => ({ id: 'claude-sonnet-4-6' }))
  }
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })) }
}))
vi.mock('@main/core/platform', () => ({ isLinux: false, isMac: true, isWin: false }))
vi.mock('@main/services/proxy/agentProxyEnvironment', () => ({
  hasStaleCherryProxyMarkers: vi.fn(() => false),
  mergeAgentLoopbackProxyBypass: vi.fn((env) => env),
  stripInheritedCherryProxyMarkers: vi.fn((env) => env)
}))
vi.mock('@main/services/proxy/proxyEnv', () => ({ getProxyEnvironment: vi.fn(() => ({})) }))
vi.mock('@main/utils/asar', () => ({ toAsarUnpackedPath: vi.fn((p: string) => p) }))
vi.mock('@main/utils/binaryResolver', () => ({ getBinaryPath: vi.fn(async () => '/fake/bun') }))
vi.mock('@main/utils/commandResolver', () => ({ autoDiscoverGitBash: vi.fn(() => undefined) }))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: vi.fn(async () => ({})),
  refreshShellEnv: vi.fn(async () => ({}))
}))

const fakeProvider = {} as Provider
const fakeAgent = {
  id: 'agent-1',
  model: 'providerId::claude-sonnet-4-6'
} as unknown as AgentEntity

describe('CLAUDE_AGENT_SDK_CLIENT_APP identification', () => {
  it('sets client-app identifier with the app version in the agent environment', async () => {
    const env = await buildEnvironment(fakeProvider, fakeAgent)

    expect(env['CLAUDE_AGENT_SDK_CLIENT_APP']).toBe('cherry-studio/1.9.99-test')
  })
})
