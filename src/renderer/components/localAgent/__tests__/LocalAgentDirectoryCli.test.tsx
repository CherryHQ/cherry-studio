import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  navigation.search = { id: 'claude' }
  MockUseDataApiUtils.mockQueryData('/agents', { items: [], total: 0, page: 1 })
  vi.mocked(ipcApi.request).mockImplementation(async (route) =>
    route === 'ai.local_agents.detect'
      ? [{ presetId: 'claude', path: '/usr/local/bin/claude' }]
      : ({ models: [] } as never)
  )
})

it('combines CLI configuration with a single local agent entry and preserves CLI-only tools', async () => {
  const cliContent = (tool: string) => <div data-testid="cli-content">{tool}</div>
  const { rerender } = render(<LocalAgentDirectory renderCli={cliContent} />)
  expect(screen.getAllByRole('button', { name: /^Claude Code ·/ })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '模型服务商' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('cli-content')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'OpenClaw' }))
  await waitFor(() => expect(screen.getByTestId('cli-content')).toHaveTextContent('openclaw'))
  navigation.search = { id: 'codex' }
  rerender(<LocalAgentDirectory renderCli={cliContent} />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Codex'))
})

it('offers terminal-only CLI access without requiring a Code Mate provider or an enabled agent', async () => {
  navigation.search = { id: 'kilo' }
  vi.mocked(ipcApi.request).mockImplementation(
    async (route) =>
      (route === 'ai.local_agents.detect'
        ? [{ presetId: 'kilo', path: '/usr/local/bin/kilo' }]
        : route === 'ai.local_agents.open_terminal'
          ? { success: true }
          : { models: [] }) as never
  )
  render(<LocalAgentDirectory />)
  expect(await screen.findByText('/usr/local/bin/kilo')).toBeVisible()
  expect(screen.getByRole('switch')).not.toBeChecked()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '在终端打开命令行' }))
  expect(ipcApi.request).toHaveBeenCalledWith('ai.local_agents.open_terminal', {
    presetId: 'kilo',
    protocol: 'acp',
    enabled: false,
    args: [],
    env: {}
  })
  expect(screen.getByRole('button', { name: '高级设置' })).toBeVisible()
})

it('offers installation before terminal actions for an absent agent', async () => {
  navigation.search = { id: 'goose' }
  render(<LocalAgentDirectory />)
  expect(await screen.findByRole('button', { name: '安装' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '在终端打开命令行' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
})

it.each([
  { order: [], expected: ['Kilo', 'Codex', 'GitHub Copilot', 'OpenClaw'] },
  {
    order: ['cli:openclaw', 'copilot', 'codex', 'removed-agent', 'kilo'],
    expected: ['Kilo', 'OpenClaw', 'GitHub Copilot', 'Codex']
  }
])('keeps status priority and applies the saved order within groups: $order', async ({ order, expected }) => {
  mockPreferenceState.set('feature.code_cli.agent_order', order)
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
        configuration: { localRuntime: { protocol: 'acp', presetId: 'kilo', enabled: true, args: [], env: {} } }
      }
    ],
    total: 1,
    page: 1
  })
  vi.mocked(ipcApi.request).mockImplementation(
    async (route) =>
      (route === 'ai.local_agents.detect'
        ? [
            { presetId: 'codex', source: 'system', path: '/usr/local/bin/codex' },
            { presetId: 'copilot', source: 'system', path: '/usr/local/bin/copilot' }
          ]
        : route === 'binary.get_tool_snapshots'
          ? { openclaw: { availability: { source: 'system', path: '/usr/local/bin/openclaw' } } }
          : { models: [] }) as never
  )
  render(<LocalAgentDirectory renderCli={() => null} />)
  await waitFor(() => {
    const names = within(screen.getByRole('complementary'))
      .getAllByRole('button', { pressed: false })
      .map((button) => button.textContent)
    expect(names.slice(0, 4)).toEqual(expected)
  })
  const rows = within(screen.getByRole('complementary'))
    .getAllByRole('button')
    .filter((button) => button.hasAttribute('aria-pressed'))
  expect(rows[4]).toHaveAccessibleName(/^Claude Code ·/)
})

it('places popular CLI-only and ACP agents together in the default order', async () => {
  mockPreferenceState.set('feature.code_cli.agent_order', [])
  vi.mocked(ipcApi.request).mockImplementation(async () => [] as never)
  render(<LocalAgentDirectory renderCli={() => null} />)
  await waitFor(() => {
    const rows = within(screen.getByRole('complementary'))
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed'))
    expect(rows.slice(0, 9).map((button) => button.getAttribute('aria-label')?.split(' · ')[0])).toEqual([
      'Claude Code',
      'Codex',
      'Cursor',
      'OpenCode',
      'GitHub Copilot',
      'OpenClaw',
      'DeepSeek Harness',
      'Pi',
      'Hermes'
    ])
  })
})
