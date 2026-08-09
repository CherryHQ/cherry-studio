import type * as CherryStudioUi from '@cherrystudio/ui'
import type { McpServer } from '@shared/data/types/mcpServer'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import McpSettings from '../McpSettings'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const mockUseMcpServer = vi.hoisted(() => vi.fn())
const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  deleteMcpServer: vi.fn(),
  navigate: vi.fn(),
  request: vi.fn(),
  updateMcpServer: vi.fn()
}))

let currentServer: McpServer
let currentSearch: { autoEnable?: 'true' }

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServer: mockUseMcpServer
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ serverId: currentServer.id }),
  useSearch: () => currentSearch
}))

vi.mock('@renderer/services/popup', () => ({
  popup: {
    confirm: mocks.confirm,
    error: vi.fn()
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    on: vi.fn(() => vi.fn()),
    request: mocks.request
  }
}))

vi.mock('@renderer/data/hooks/useCache', () => ({ useSharedCacheValue: () => undefined }))
vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatus: () => ({ state: 'disabled', lastError: undefined })
}))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))

vi.mock('@renderer/components/CollapsibleSearchBar', () => ({ default: () => null }))
vi.mock('@renderer/components/Scrollbar', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingDivider: () => <hr />,
  SettingTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))
vi.mock('@renderer/pages/settings/McpSettings/McpDescription', () => ({ default: () => null }))
vi.mock('../McpPrompt', () => ({ default: () => null }))
vi.mock('../McpResource', () => ({ default: () => null }))
vi.mock('../McpTool', () => ({ default: () => null }))

vi.mock('../McpServerFields', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    McpEndpointField: () => null,
    McpIdentityFields: ({ form }: { form: { register: (name: 'name') => Record<string, unknown> } }) => (
      <label>
        Server name
        <input {...form.register('name')} />
      </label>
    ),
    McpRuntimeFields: () => null,
    McpTransportFields: () => null
  }
})

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key })
  }
})

describe('McpSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentServer = {
      id: 'protocol-server-id',
      name: 'protocol-server',
      type: 'stdio',
      command: 'printf',
      args: ['deeplink-test'],
      installSource: 'protocol',
      isActive: false,
      isTrusted: false
    }
    currentSearch = { autoEnable: 'true' }
    mocks.confirm.mockResolvedValue(false)
    mocks.updateMcpServer.mockResolvedValue(undefined)
    mockUseMcpServer.mockImplementation(() => ({
      server: currentServer,
      isLoading: false,
      updateMcpServer: mocks.updateMcpServer,
      deleteMcpServer: mocks.deleteMcpServer
    }))
  })

  it('consumes protocol auto-enable and shows the run confirmation once without enabling when canceled', async () => {
    render(<McpSettings />)

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'settings.mcp.protocolInstallWarning.title' })
    )
    expect(mocks.confirm.mock.calls[0][0].content).toMatchObject({ props: { server: currentServer } })
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/settings/mcp/settings/$serverId',
      params: { serverId: currentServer.id },
      search: {},
      replace: true
    })
    expect(mocks.updateMcpServer).not.toHaveBeenCalled()
  })

  it('preserves edits for the same server ID and loads defaults for a different server ID', async () => {
    currentSearch = {}
    currentServer = {
      id: 'server-a',
      name: 'Server A',
      type: 'stdio',
      command: 'server-a',
      isActive: false
    }
    const user = userEvent.setup()
    const { rerender } = render(<McpSettings />)
    const nameInput = screen.getByRole('textbox', { name: 'Server name' })

    await user.clear(nameInput)
    await user.type(nameInput, 'Unsaved server name')

    currentServer = { ...currentServer, name: 'Refetched Server A' }
    rerender(<McpSettings />)

    expect(screen.getByRole('textbox', { name: 'Server name' })).toHaveValue('Unsaved server name')

    currentServer = {
      id: 'server-b',
      name: 'Server B',
      type: 'stdio',
      command: 'server-b',
      isActive: false
    }
    rerender(<McpSettings />)

    expect(screen.getByRole('textbox', { name: 'Server name' })).toHaveValue('Server B')
  })

  it('renders selectable MCP logs and copies them to the clipboard', async () => {
    currentSearch = {}
    currentServer = {
      id: 'server-a',
      name: 'Server A',
      type: 'stdio',
      command: 'server-a',
      isActive: true
    }
    const logs = [
      { timestamp: 1700000000000, level: 'info', message: 'Server started' },
      { timestamp: 1700000001000, level: 'error', message: 'Connection failed', data: { detail: 'timeout' } }
    ]
    const clipboardWriteText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'mcp.server.get_logs') return Promise.resolve(logs)
      if (channel === 'mcp.server.get_version') return Promise.resolve('1.0.0')
      return Promise.resolve([])
    })

    const user = userEvent.setup()
    const { container } = render(<McpSettings />)

    await user.click(screen.getByRole('radio', { name: 'Logs' }))

    expect(await screen.findByText('Server started')).toBeInTheDocument()
    expect(screen.getByText('Connection failed')).toBeInTheDocument()

    const logList = container.querySelector('.selectable')
    expect(logList).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Copy logs' }))
    expect(clipboardWriteText).toHaveBeenCalledWith(
      `[${new Date(logs[0].timestamp).toLocaleTimeString()}] [INFO] Server started\n[${new Date(logs[1].timestamp).toLocaleTimeString()}] [ERROR] Connection failed\n${JSON.stringify(logs[1].data, null, 2)}`
    )
  })
})
