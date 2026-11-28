import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'

import { LocalAgentDirectory } from '../LocalAgentDirectory'

const navigation = vi.hoisted(() => ({ search: { id: 'claude' }, navigate: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => navigation.search,
  useNavigate: () => navigation.navigate
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))
vi.mock('@renderer/hooks/useModel', () => ({ useModels: () => ({ models: [] }) }))
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] }),
  getProviderDisplayName: (provider: { name: string }) => provider.name
}))
vi.unmock('@cherrystudio/ui')

beforeEach(() => {
  mockPreferenceState.set('feature.code_cli.configs', {})
  navigation.search = { id: 'claude' }
  MockUseDataApiUtils.mockQueryData('/agents', { items: [], total: 0, page: 1 })
  vi.mocked(ipcApi.request).mockImplementation(async (route) =>
    route === 'code_cli.get_available_terminals'
      ? []
      : route === 'ai.local_agents.detect'
        ? [{ presetId: 'claude', path: '/usr/local/bin/claude' }]
        : ({ models: [] } as never)
  )
})

it('keeps enabled Agents first and applies the saved order within each status', async () => {
  mockPreferenceState.set('feature.code_cli.agent_order', ['cli:openclaw', 'copilot', 'codex', 'removed-agent', 'kilo'])
  MockUseDataApiUtils.mockQueryData('/agents', {
    items: [
      {
        id: 'enabled-kilo',
        name: 'Kilo',
        type: 'local',
        model: null,
        modelName: null,
        orderKey: 'a0',
        createdAt: '',
        updatedAt: '',
        localRuntime: { providerId: 'kilo-provider', presetId: 'kilo', enabled: true, args: [], env: {} }
      }
    ],
    total: 1,
    page: 1
  })
  vi.mocked(ipcApi.request).mockImplementation(
    async (route) =>
      (route === 'ai.local_agents.detect'
        ? [
            { presetId: 'openclaw', source: 'system', path: '/usr/local/bin/openclaw' },
            { presetId: 'codex', source: 'system', path: '/usr/local/bin/codex' },
            { presetId: 'copilot', source: 'system', path: '/usr/local/bin/copilot' }
          ]
        : { models: [] }) as never
  )
  render(<LocalAgentDirectory />)
  await waitFor(() => {
    const names = within(screen.getByRole('complementary'))
      .getAllByRole('button', { name: / · |^(OpenClaw|DeepSeek Harness)$/ })
      .map((button) => button.textContent)
    expect(names.slice(0, 4)).toEqual(['Kilo', 'OpenClaw', 'GitHub Copilot', 'Codex'])
  })
  const rows = within(screen.getByRole('complementary')).getAllByRole('button', {
    name: / · |^(OpenClaw|DeepSeek Harness)$/
  })
  expect(rows[4]).toHaveAccessibleName(/^Cursor ·/)
  expect(rows[5]).toHaveAccessibleName(/^Claude Code ·/)
})

it.each([
  ['deepseek-harness', 'DeepSeek Harness'],
  ['openclaw', 'OpenClaw']
])('opens existing %s links as one ACP entry and preserves its saved order', async (id, name) => {
  navigation.search = { id: `cli:${id}` }
  mockPreferenceState.set('feature.code_cli.agent_order', [`cli:${id}`, 'claude'])
  vi.mocked(ipcApi.request).mockImplementation(async (route) =>
    route === 'ai.local_agents.detect'
      ? ([{ presetId: id, source: 'system', path: `/usr/local/bin/${id}` }] as never)
      : ([] as never)
  )
  render(<LocalAgentDirectory />)
  expect(await screen.findByRole('heading', { name })).toBeVisible()
  expect(screen.getByRole('switch')).not.toBeChecked()
  const rows = within(screen.getByRole('complementary')).getAllByRole('button', { name: / · |^OpenClaw$/ })
  expect(rows[0].getAttribute('aria-label')?.split(' · ')[0]).toBe(name)
  expect(rows.filter((row) => row.getAttribute('aria-label')?.startsWith(name))).toHaveLength(1)
})
