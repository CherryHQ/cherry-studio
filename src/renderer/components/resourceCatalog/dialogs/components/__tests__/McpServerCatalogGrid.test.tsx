import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { McpServer } from '@shared/data/types/mcpServer'

import { McpServerCatalogGrid } from '../McpServerCatalogGrid'

vi.unmock('@cherrystudio/ui')

const servers = [
  { id: 'a', name: 'Files', isActive: true, type: 'stdio' },
  { id: 'b', name: 'Research', isActive: true, type: 'stdio' }
] as McpServer[]

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  MockUseDataApiUtils.resetMocks()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('McpServerCatalogGrid', () => {
  it('keeps a selected seed server visible when the cached catalog is stale', async () => {
    // Live query resolves with rows that predate another window adding 'b':
    // the creation snapshot still holds it, and it must stay reviewable.
    MockUseDataApiUtils.mockQueryData('/mcp-servers', { items: [servers[0]], total: 1, page: 1 })
    const onToggle = vi.fn()
    render(
      <McpServerCatalogGrid
        enabledIds={new Set(['a', 'b'])}
        emptyLabel="No servers"
        portalContainer={null}
        servers={servers}
        onToggle={onToggle}
      />
    )
    const research = await screen.findByRole('switch', { name: 'Research' })
    expect(research).toBeChecked()
    const user = userEvent.setup()
    await user.click(research)
    expect(onToggle).toHaveBeenCalledWith('b', false)
  })

  it('shows a catalog-specific error with a retry when the server list fails to load', async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    MockUseDataApiUtils.mockQueryResult('/mcp-servers', {
      data: undefined,
      isLoading: false,
      error: new Error('offline'),
      refetch: retry
    })
    render(
      <McpServerCatalogGrid enabledIds={new Set()} emptyLabel="No servers" portalContainer={null} onToggle={vi.fn()} />
    )
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the MCP server list.")
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
