import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import type { McpTool } from '@renderer/types/tool'
import type { McpServer } from '@shared/data/types/mcpServer'

vi.unmock('@cherrystudio/ui')
vi.unmock('react-i18next')

import McpToolsSection from '../McpTool'

const i18n = createInstance()
await i18n.init({ lng: 'en-US', keySeparator: false, resources: { 'en-US': { translation: en } } })

const tool: McpTool = {
  id: 'search-tool',
  name: 'search',
  description: 'Search reports',
  type: 'mcp',
  serverId: 'origin',
  serverName: 'Origin',
  inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search terms' } } }
}
let server: McpServer

const panel = (searchText = '') => {
  MockUseDataApiUtils.mockQueryData('/mcp-servers', { items: [server], total: 1, page: 1 })
  return (
    <I18nextProvider i18n={i18n}>
      <McpToolsSection
        tools={[tool]}
        server={server}
        searchText={searchText}
        onToggleTool={(entry, enabled) => {
          server = { ...server, disabledTools: enabled ? [] : [entry.name] }
        }}
        onToggleAutoApprove={(entry, autoApprove) => {
          server = { ...server, disabledAutoApproveTools: autoApprove ? [] : [entry.name] }
        }}
      />
    </I18nextProvider>
  )
}

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  server = { id: tool.serverId, name: tool.serverName, isActive: true, disabledAutoApproveTools: [tool.name] }
})

it('keeps tool enablement and auto approval working through the shared table', async () => {
  const user = userEvent.setup()
  const view = render(panel())
  const enableLabel = 'Enable Tool: search'
  const autoApproveLabel = 'Auto Approve: search'
  expect(screen.getByRole('switch', { name: enableLabel })).toBeChecked()
  await user.click(screen.getByRole('switch', { name: autoApproveLabel }))
  view.rerender(panel())
  expect(screen.getByRole('switch', { name: autoApproveLabel })).toBeChecked()
  await user.click(screen.getByRole('switch', { name: enableLabel }))
  view.rerender(panel())
  expect(screen.getByRole('switch', { name: enableLabel })).not.toBeChecked()
  expect(screen.getByRole('switch', { name: autoApproveLabel })).toBeDisabled()
  await user.click(screen.getByRole('switch', { name: enableLabel }))
  view.rerender(panel())
  expect(screen.getByRole('switch', { name: autoApproveLabel })).toBeEnabled()
  expect(screen.getByRole('switch', { name: autoApproveLabel })).toBeChecked()
})

it('retains schema expansion and search filtering', async () => {
  const user = userEvent.setup()
  const view = render(panel())
  await user.click(screen.getByRole('button', { name: 'Expand row' }))
  expect(screen.getByText('Search terms')).toBeInTheDocument()
  view.rerender(panel('missing'))
  expect(screen.queryByText('search', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByText('No results')).toBeInTheDocument()
})
