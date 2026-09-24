import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { PopupHost } from '@renderer/components/PopupHost'
import type * as PopupModule from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { WebSearchProviderMenuEntry } from '@renderer/utils/webSearchProviderMeta'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { ProtocolMcpServerInstall } from '@shared/data/types/mcpProtocolInstall'

import McpProtocolInstallDialog from '../../McpSettings/McpProtocolInstallDialog'
import { WebSearchProviderSetting } from '../components/WebSearchProviderSetting'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('@renderer/services/popup', async (importOriginal) => importOriginal<typeof PopupModule>())

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn()
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('../components/WebSearchProviderLogo', () => ({
  default: ({ providerName }: { providerName: string }) => <span>{providerName}</span>
}))

vi.mock('../hooks/useWebSearchProviderCheck', () => ({
  useWebSearchProviderCheck: () => ({
    canCheck: false,
    checking: false,
    checkProvider: vi.fn()
  })
}))

vi.mock('../hooks/useWebSearchApiKeyList', () => ({
  useWebSearchApiKeyList: () => ({
    provider: tavilyProvider,
    keys: tavilyProvider.apiKeys,
    displayItems: tavilyProvider.apiKeys.map((key, index) => ({
      id: `saved-${index}-${key}`,
      key,
      index,
      isNew: false
    })),
    hasPendingNewKey: false,
    addPendingKey: vi.fn(),
    updateListItem: vi.fn(),
    removeListItem: vi.fn()
  })
}))

const tavilyProvider: WebSearchProvider = {
  id: 'tavily',
  name: 'Tavily',
  type: 'api',
  apiKeys: ['key-a'],
  capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
  engines: [],
  basicAuthUsername: '',
  basicAuthPassword: ''
}

const tavilyEntry: WebSearchProviderMenuEntry = {
  key: 'searchKeywords:tavily',
  capability: 'searchKeywords',
  provider: tavilyProvider,
  providerCapability: tavilyProvider.capabilities[0]
}

const protocolServers: ProtocolMcpServerInstall[] = [
  {
    name: 'modelscope-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelscope/mcp-server'],
    installSource: 'protocol',
    isActive: false,
    isTrusted: false,
    installedAt: 1
  }
]

function createProps() {
  return {
    entry: tavilyEntry,
    entries: [tavilyEntry],
    providerOverrides: {},
    sectionTitle: 'settings.tool.websearch.search_provider',
    sectionTitleId: 'web-search-searchKeywords-title',
    onSetApiKeys: vi.fn().mockResolvedValue(undefined),
    onSetBasicAuth: vi.fn().mockResolvedValue(undefined),
    onSetCapabilityApiHost: vi.fn().mockResolvedValue(undefined),
    onSetDefaultProvider: vi.fn().mockResolvedValue(undefined),
    onUpdateProvider: vi.fn().mockResolvedValue(undefined)
  }
}

describe('Web Search and MCP dialog lifecycle', () => {
  it('keeps the API key dialog closed when saving the inline draft fails', async () => {
    const props = createProps()
    props.onSetApiKeys.mockRejectedValue(new Error('persist failed'))
    const user = userEvent.setup()

    render(
      <>
        <WebSearchProviderSetting {...props} />
        <PopupHost />
      </>
    )

    const input = screen.getByPlaceholderText('settings.provider.api_key.label')
    await user.clear(input)
    await user.type(input, 'key-b')
    await user.click(screen.getByRole('button', { name: 'settings.provider.api.key.list.open' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('settings.tool.websearch.errors.save_failed')
    })
    expect(
      screen.queryByRole('dialog', { name: 'Tavily settings.provider.api.key.list.title' })
    ).not.toBeInTheDocument()
  })

  it('removes the API key dialog when MCP navigation unmounts Web Search settings', async () => {
    const props = createProps()
    const onClose = vi.fn()
    const user = userEvent.setup()
    const view = render(
      <>
        <WebSearchProviderSetting {...props} />
        <PopupHost />
      </>
    )

    await user.click(screen.getByRole('button', { name: 'settings.provider.api.key.list.open' }))

    const keyListTitle = 'Tavily settings.provider.api.key.list.title'
    expect(await screen.findByRole('dialog', { name: keyListTitle })).toBeInTheDocument()

    view.rerender(
      <>
        <McpProtocolInstallDialog
          servers={protocolServers}
          onClose={onClose}
          onInstall={vi.fn().mockResolvedValue(undefined)}
        />
        <PopupHost />
      </>
    )

    expect(screen.queryByRole('dialog', { name: keyListTitle, hidden: true })).not.toBeInTheDocument()
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
