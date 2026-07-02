import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import McpProviderSettings from '../McpProviderSettings'
import type { ProviderConfig } from '../providers/config'

const syncServers = vi.fn()

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({ addMcpServer: vi.fn() })
}))

vi.mock('..', () => ({
  SettingsContentColumn: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

vi.mock('../utils', () => ({
  isSameMcpServerCandidate: () => false,
  toCreateMcpServerDto: (s: unknown) => s
}))

vi.mock('../providers/config', () => ({
  getProviderDisplayName: (p: { nameKey: string }) => p.nameKey
}))

vi.mock('@renderer/components/CollapsibleSearchBar', () => ({
  default: () => <div data-testid="search-bar" />
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, disabled }: { children?: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key })
}))

const PERSIST_KEY = 'feature.mcp.provider_available_servers'

function makeProvider(key: string): ProviderConfig {
  return {
    key,
    nameKey: `Provider ${key}`,
    descriptionKey: '',
    discoverUrl: '',
    apiKeyUrl: '',
    tokenFieldName: 'token',
    getToken: () => 'tok',
    saveToken: vi.fn(),
    syncServers
  } as unknown as ProviderConfig
}

describe('McpProviderSettings persist cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
    window.toast = { success: vi.fn(), error: vi.fn() } as unknown as typeof window.toast
  })

  it('merges fetched servers without clobbering another provider in the persist cache', async () => {
    // A sibling provider's cached list is already present.
    MockUseCacheUtils.setPersistCacheValue(PERSIST_KEY, { bailian: [{ name: 'srv-bailian' }] } as never)
    syncServers.mockResolvedValue({ success: true, message: '', allServers: [{ name: 'srv-modelscope' }] })

    render(<McpProviderSettings provider={makeProvider('modelscope')} existingServers={[]} />)

    fireEvent.click(screen.getByText('Fetch Servers'))

    await waitFor(() => expect(syncServers).toHaveBeenCalledWith('tok'))

    await waitFor(() => {
      const cached = MockUseCacheUtils.getPersistCacheValue(PERSIST_KEY) as Record<string, Array<{ name: string }>>
      // The freshly fetched provider is stored…
      expect(cached.modelscope).toEqual([{ name: 'srv-modelscope' }])
      // …and the sibling provider's list survives the write (the `...allServers` spread).
      expect(cached.bailian).toEqual([{ name: 'srv-bailian' }])
    })
  })
})
