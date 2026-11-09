import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openExternalWebsite } from '@renderer/services/website'
import type { McpProviderKey } from '@renderer/utils/mcpDiscovery'
import type { McpServer } from '@shared/data/types/mcpServer'

import McpProviderSettings from '../MarketplaceMcpProvider'
import type { ProviderConfig } from '../providers/config'

const syncServers = vi.fn()
const addMcpServer = vi.fn()

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ addMcpServer })
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('@renderer/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))
vi.mock('@renderer/services/website', () => ({ openExternalWebsite: vi.fn() }))

const PERSIST_KEY = 'feature.mcp.provider_available_servers'
const server: McpServer = {
  id: '@bailian/search',
  name: 'Search',
  type: 'streamableHttp',
  baseUrl: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer tok' },
  isActive: false
}

function makeProvider(key: McpProviderKey): ProviderConfig {
  let token = 'tok'
  return {
    key,
    nameKey: `Provider ${key}`,
    discoverUrl: '',
    apiKeyUrl: '',
    tokenFieldName: 'token',
    getToken: () => token,
    saveToken: vi.fn((value: string) => {
      token = value
    }),
    syncServers
  }
}

describe('MCP provider configuration', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en-us')
    vi.resetAllMocks()
    MockUseCacheUtils.resetMocks()
  })
  afterEach(cleanup)

  it('merges fetched servers without clobbering another provider in the persist cache', async () => {
    const user = userEvent.setup()
    MockUseCacheUtils.setPersistCacheValue(PERSIST_KEY, { bailian: [server] })
    syncServers.mockResolvedValue({
      success: true,
      message: '',
      allServers: [{ ...server, name: 'ModelScope search' }]
    })

    render(<McpProviderSettings provider={makeProvider('modelscope')} existingServers={[]} />)

    await user.click(screen.getByRole('button', { name: 'Fetch Servers' }))
    expect(await screen.findByText('ModelScope search')).toBeVisible()

    await waitFor(() => {
      const cached = MockUseCacheUtils.getPersistCacheValue(PERSIST_KEY) as Record<string, Array<{ name: string }>>
      expect(cached.modelscope).toEqual([{ ...server, name: 'ModelScope search' }])
      expect(cached.bailian).toEqual([server])
    })
  })

  it('clears cached candidates when the saved token is cleared', async () => {
    const user = userEvent.setup()
    const provider = makeProvider('modelscope')
    MockUseCacheUtils.setPersistCacheValue(PERSIST_KEY, { modelscope: [server] })

    render(<McpProviderSettings provider={provider} existingServers={[]} />)

    await user.clear(screen.getByDisplayValue('tok'))

    expect(provider.saveToken).toHaveBeenCalledWith('')
    expect(screen.queryByText('Search', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fetch Servers' })).toBeDisabled()
  })

  it('opens named provider links in the system browser', async () => {
    const user = userEvent.setup()
    const provider = {
      ...makeProvider('modelscope'),
      apiKeyUrl: 'https://example.com/api-keys',
      discoverUrl: 'https://example.com/market'
    }
    render(<McpProviderSettings provider={provider} existingServers={[]} />)

    await user.click(screen.getByRole('link', { name: 'Get API Key' }))
    expect(openExternalWebsite).toHaveBeenCalledWith('https://example.com/api-keys')
    await user.click(screen.getByRole('link', { name: 'Open website: Provider modelscope' }))
    expect(openExternalWebsite).toHaveBeenCalledWith('https://example.com/market')
  })

  it('discards a fetched list if the API key changed while the request was pending', async () => {
    const user = userEvent.setup()
    let resolve!: (value: { success: boolean; allServers: McpServer[] }) => void
    syncServers.mockReturnValue(new Promise((done) => (resolve = done)))
    MockUseCacheUtils.setPersistCacheValue(PERSIST_KEY, { bailian: [server], modelscope: [server] })
    render(<McpProviderSettings provider={makeProvider('bailian')} existingServers={[]} />)

    await user.click(screen.getByRole('button', { name: 'Fetch Servers' }))
    await user.clear(screen.getByDisplayValue('tok'))
    await user.type(screen.getByPlaceholderText('Enter API token here'), 'replacement')
    await act(async () => resolve({ success: true, allServers: [server] }))

    expect(screen.queryByText('Search', { exact: true })).not.toBeInTheDocument()
    expect(MockUseCacheUtils.getPersistCacheValue(PERSIST_KEY)).toEqual({ modelscope: [server] })
  })

  it('submits each candidate once and permits retry after a failed add', async () => {
    const user = userEvent.setup()
    let reject!: (reason: Error) => void
    addMcpServer.mockReturnValueOnce(new Promise((_resolve, fail) => (reject = fail)))
    addMcpServer.mockResolvedValue(server)
    MockUseCacheUtils.setPersistCacheValue(PERSIST_KEY, { bailian: [server] })
    const provider = makeProvider('bailian')
    const { rerender } = render(<McpProviderSettings provider={provider} existingServers={[]} />)

    const add = screen.getByRole('button', { name: 'Add: Search' })
    await user.dblClick(add)
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('aria-busy', 'true')
    expect(addMcpServer).toHaveBeenCalledTimes(1)
    await act(async () => reject(new Error('offline')))
    expect(add).toBeEnabled()

    await user.click(add)
    rerender(<McpProviderSettings provider={provider} existingServers={[server]} />)
    expect(await screen.findByRole('button', { name: 'Added: Search' })).toBeDisabled()
    expect(addMcpServer).toHaveBeenCalledTimes(2)
    rerender(<McpProviderSettings provider={provider} existingServers={[]} />)
    expect(screen.getByRole('button', { name: 'Add: Search' })).toBeEnabled()
  })
})
