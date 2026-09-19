import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { HealthOverview } from '../HealthOverview'

let providers: Provider[] = []
let models: Model[] = []
let modelHealth: ModelHealthMemory = {}
let mcpServers: McpServer[] = []
let mcpStatuses: Record<string, McpRuntimeStatus | undefined> = {}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key)
  })
}))

vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@renderer/hooks/useProvider', () => ({ useProviders: () => ({ providers }) }))
vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models }) }))
vi.mock('@data/hooks/usePreference', () => ({ usePreference: () => [modelHealth, vi.fn()] }))
vi.mock('@renderer/hooks/useMcpServer', () => ({ useMcpServers: () => ({ mcpServers }) }))
vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({ useMcpRuntimeStatusMap: () => mcpStatuses }))

function makeProvider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: id,
    apiKeys: [],
    authType: 'api-key',
    reportsActualCost: false,
    settings: {},
    isEnabled: true,
    ...overrides
  }
}

describe('HealthOverview', () => {
  beforeEach(() => {
    providers = []
    models = []
    modelHealth = {}
    mcpServers = []
    mcpStatuses = {}
  })

  it('reports how many enabled providers have a usable credential', () => {
    providers = [
      makeProvider('openai', { apiKeys: [{ id: 'k1', isEnabled: true }] }),
      makeProvider('groq', { apiKeys: [{ id: 'k2', isEnabled: false }] })
    ]

    render(<HealthOverview />)

    expect(screen.getByText('settings.about.health.providers.value:{"connected":1,"enabled":2}')).toBeInTheDocument()
  })

  it('says plainly that no local runtime is enabled when none is', () => {
    render(<HealthOverview />)

    expect(screen.getByText('settings.about.health.localRuntime.empty')).toBeInTheDocument()
  })

  it('names an enabled local runtime provider that has never been checked', () => {
    providers = [makeProvider('lmstudio', { authOptional: true, name: 'LM Studio' })]

    render(<HealthOverview />)

    expect(screen.getByText('settings.about.health.localRuntime.unknown:{"name":"LM Studio"}')).toBeInTheDocument()
  })

  it('shows the most recent MCP error instead of the empty state', () => {
    mcpServers = [{ id: 'memory', name: 'memory', isActive: true }]
    mcpStatuses = { memory: { state: 'error', lastCheckedAt: Date.parse('2026-09-19T00:00:00Z'), lastError: 'boom' } }

    render(<HealthOverview />)

    expect(screen.queryByText('settings.about.health.mcp.lastError.empty')).not.toBeInTheDocument()
    expect(screen.getByText(/settings\.about\.health\.mcp\.lastError\.value:/)).toBeInTheDocument()
  })
})
