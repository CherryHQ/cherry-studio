import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { useBuiltinMcpCatalog } from '@renderer/hooks/useBuiltinMcpCatalog'
import type { McpProviderKey } from '@renderer/utils/mcpDiscovery'
import { PRESET_MCP_SERVERS } from '@shared/data/presets/mcpServers'
import { BuiltinMcpServerNames } from '@shared/utils/mcp'

import { MarketplaceMcp } from '../MarketplaceMcp'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@renderer/hooks/useMcpServer', () => ({ useMcpServers: () => ({ addMcpServer: vi.fn() }) }))

function Catalog({
  presets = [],
  moreSources = true
}: {
  presets?: ReturnType<typeof useBuiltinMcpCatalog>['presets']
  moreSources?: boolean
}) {
  const [providerKey, setProviderKey] = useState<McpProviderKey>()
  const catalog: ReturnType<typeof useBuiltinMcpCatalog> = {
    presets,
    mcpServers: [],
    findInstalled: () => undefined,
    add: vi.fn(),
    adding: new Set(),
    isLoading: false,
    error: undefined,
    retry: vi.fn()
  }
  return (
    <MarketplaceMcp
      catalog={catalog}
      query=""
      moreSources={moreSources}
      active
      providerKey={providerKey}
      onProviderChange={setProviderKey}
    />
  )
}

beforeEach(async () => {
  await i18next.changeLanguage('en-us')
  MockUseCacheUtils.resetMocks()
  localStorage.clear()
})
afterEach(cleanup)

it('configures a provider inside Marketplace and retains its saved API key when reopened', async () => {
  const user = userEvent.setup()
  localStorage.setItem('modelscope_token', 'saved-token')
  render(<Catalog />)
  const configure = screen.getByRole('button', { name: 'Configure: ModelScope' })
  await user.click(configure)
  expect(screen.getByRole('dialog', { name: 'ModelScope' })).toBeVisible()
  const token = await screen.findByDisplayValue('saved-token')
  await user.clear(token)
  await user.type(token, 'replacement-token')
  expect(localStorage.getItem('modelscope_token')).toBe('replacement-token')
  await user.click(screen.getByRole('button', { name: /^Close$/ }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(configure).toHaveFocus()
  await user.click(configure)
  expect(await screen.findByDisplayValue('replacement-token')).toBeVisible()
})

it('explains filesystem configuration before the server is installed', async () => {
  const user = userEvent.setup()
  const filesystem = PRESET_MCP_SERVERS.find((preset) => preset.name === BuiltinMcpServerNames.filesystem)!
  render(<Catalog presets={[filesystem]} moreSources={false} />)

  await user.click(screen.getByText(BuiltinMcpServerNames.filesystem, { exact: true }))

  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByRole('heading', { name: 'Configuration guide' })).toBeVisible()
  expect(dialog.getByText(/first line of Arguments/)).toHaveTextContent('built-in MCP workspace')
  expect(dialog.getByText('WORKSPACE_ROOT=/absolute/path/to/workspace', { exact: true })).toBeVisible()
})

it('shows the ZoneFoundry setup guide in the current Marketplace detail dialog', async () => {
  const user = userEvent.setup()
  const zonefoundry = PRESET_MCP_SERVERS.find((preset) => preset.name === BuiltinMcpServerNames.zonefoundry)!
  render(<Catalog presets={[zonefoundry]} moreSources={false} />)
  await user.click(screen.getByText(BuiltinMcpServerNames.zonefoundry, { exact: true }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText(/Third-party ZoneFoundry relay/, { selector: 'p:not(.sr-only)' })).toBeVisible()
  expect(dialog.getByRole('link', { name: 'ZoneFoundry setup guide' })).toHaveAttribute(
    'href',
    'https://zonefoundry.dev/guides/ai-agent-control/'
  )
  expect(dialog.getByRole('button', { name: 'Add: @cherry/zonefoundry' })).toBeEnabled()
})
