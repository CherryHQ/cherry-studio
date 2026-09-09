import type * as CherryStudioUi from '@cherrystudio/ui'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpServerLogEntry } from '@shared/types/mcp'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import McpSettings from '../McpSettings'
import { formatMcpLogs } from '../utils'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const mockUseMcpServer = vi.hoisted(() => vi.fn())
const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  invalidate: vi.fn(),
  navigate: vi.fn(),
  on: vi.fn<(event: string, callback: (log: McpServerLogEntry & { serverId: string }) => void) => () => void>(() =>
    vi.fn()
  ),
  request: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  updateMcpServer: vi.fn()
}))

let currentServer: McpServer
let currentSearch: { autoEnable?: 'true' }

// Keep the real useMcpServerMutations so the delete tests exercise the actual
// remove flow (IPC channel + cache invalidation), not a stand-in.
vi.mock('@renderer/hooks/useMcpServer', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMcpServer: mockUseMcpServer
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ serverId: currentServer.id }),
  getRouteApi: () => ({ useSearch: () => currentSearch })
}))

vi.mock('@renderer/services/popup', () => ({
  popup: {
    confirm: mocks.confirm,
    error: vi.fn()
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    on: mocks.on,
    request: mocks.request
  }
}))

vi.mock('@renderer/data/hooks/useCache', () => ({ useSharedCacheValue: () => undefined }))
vi.mock('@renderer/data/hooks/useDataApi', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return { ...actual, useInvalidateCache: () => mocks.invalidate }
})
vi.mock('@renderer/services/toast', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError
  }
}))
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
    mocks.invalidate.mockResolvedValue(undefined)
    mocks.updateMcpServer.mockResolvedValue(undefined)
    mockUseMcpServer.mockImplementation(() => ({
      server: currentServer,
      isLoading: false,
      updateMcpServer: mocks.updateMcpServer
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
    const logs: McpServerLogEntry[] = [
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

    expect(mocks.on).not.toHaveBeenCalledWith('mcp.server.log', expect.any(Function))
    expect(mocks.request).not.toHaveBeenCalledWith('mcp.server.get_logs', expect.anything())

    await user.click(screen.getByRole('radio', { name: 'Logs' }))

    expect(mocks.on).toHaveBeenCalledWith('mcp.server.log', expect.any(Function))
    expect(await screen.findByText('Server started')).toBeInTheDocument()
    expect(screen.getByText('Connection failed')).toBeInTheDocument()

    const liveLog = {
      serverId: currentServer.id,
      timestamp: 1700000002000,
      level: 'info' as const,
      message: 'Live log'
    }
    const logListener = mocks.on.mock.calls.find(([event]) => event === 'mcp.server.log')?.[1]
    act(() => {
      logListener?.(liveLog)
    })
    expect(screen.getByText('Live log')).toBeInTheDocument()

    // `.selectable` is the maintained contract that opts the log list out of the
    // global `user-select: none` (src/renderer/assets/styles/index.css).
    expect(container.querySelector('.selectable')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Copy logs' }))
    expect(clipboardWriteText).toHaveBeenCalledWith(formatMcpLogs([...logs, liveLog]))
  })

  it('defers tools/prompts/resources fetches until the matching tab is first opened', async () => {
    currentSearch = {}
    currentServer = {
      id: 'server-a',
      name: 'Server A',
      type: 'stdio',
      command: 'server-a',
      isActive: true
    }

    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'mcp.server.get_version') return Promise.resolve('1.0.0')
      if (channel === 'mcp.server.list_prompts') return Promise.resolve([])
      if (channel === 'mcp.server.list_resources') return Promise.resolve([])
      return Promise.resolve([])
    })

    const user = userEvent.setup()
    render(<McpSettings />)

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('mcp.server.get_version', { serverId: currentServer.id })
    )
    expect(mocks.request).not.toHaveBeenCalledWith('mcp.server.refresh_tools', expect.anything())
    expect(mocks.request).not.toHaveBeenCalledWith('mcp.server.list_prompts', expect.anything())
    expect(mocks.request).not.toHaveBeenCalledWith('mcp.server.list_resources', expect.anything())

    await user.click(screen.getByRole('radio', { name: 'settings.mcp.tabs.tools' }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('mcp.server.refresh_tools', { serverId: currentServer.id })
    )
    expect(mocks.request).not.toHaveBeenCalledWith('mcp.server.list_prompts', expect.anything())
    expect(mocks.request).not.toHaveBeenCalledWith('mcp.server.list_resources', expect.anything())

    await user.click(screen.getByRole('radio', { name: 'settings.mcp.tabs.prompts' }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('mcp.server.list_prompts', { serverId: currentServer.id })
    )
    expect(mocks.request).not.toHaveBeenCalledWith('mcp.server.list_resources', expect.anything())

    await user.click(screen.getByRole('radio', { name: 'settings.mcp.tabs.resources' }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('mcp.server.list_resources', { serverId: currentServer.id })
    )

    mocks.request.mockClear()
    await user.click(screen.getByRole('radio', { name: 'settings.mcp.tabs.tools' }))
    await user.click(screen.getByRole('radio', { name: 'settings.mcp.tabs.prompts' }))
    await user.click(screen.getByRole('radio', { name: 'settings.mcp.tabs.resources' }))

    expect(mocks.request).not.toHaveBeenCalledWith('mcp.server.refresh_tools', expect.anything())
    expect(mocks.request).not.toHaveBeenCalledWith('mcp.server.list_prompts', expect.anything())
    expect(mocks.request).not.toHaveBeenCalledWith('mcp.server.list_resources', expect.anything())
  })

  it('retries a capability tab fetch after the first IPC call fails', async () => {
    currentSearch = {}
    currentServer = {
      id: 'server-a',
      name: 'Server A',
      type: 'stdio',
      command: 'server-a',
      isActive: true
    }

    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'mcp.server.get_version') return Promise.resolve('1.0.0')
      if (channel === 'mcp.server.refresh_tools') return Promise.reject(new Error('unreachable'))
      return Promise.resolve([])
    })

    const user = userEvent.setup()
    render(<McpSettings />)

    await user.click(screen.getByRole('radio', { name: 'settings.mcp.tabs.tools' }))
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('mcp.server.refresh_tools', { serverId: currentServer.id })
    )

    mocks.request.mockClear()
    mocks.request.mockImplementation((channel: string) => {
      if (channel === 'mcp.server.get_version') return Promise.resolve('1.0.0')
      if (channel === 'mcp.server.refresh_tools') return Promise.resolve([])
      return Promise.resolve([])
    })

    await user.click(screen.getByRole('radio', { name: 'Logs' }))
    await user.click(screen.getByRole('radio', { name: 'settings.mcp.tabs.tools' }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('mcp.server.refresh_tools', { serverId: currentServer.id })
    )
  })

  it('deletes via the mcp.server.remove IPC channel, refreshes the cache, and navigates back', async () => {
    currentSearch = {}
    currentServer = { id: 'server-a', name: 'Server A', type: 'stdio', command: 'server-a', isActive: false }
    mocks.confirm.mockResolvedValue(true)
    mocks.request.mockResolvedValue(undefined)

    const user = userEvent.setup()
    render(<McpSettings />)
    await user.click(screen.getByRole('button', { name: /common\.delete/ }))

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/mcp' }))
    expect(mocks.request).toHaveBeenCalledWith('mcp.server.remove', { serverId: 'server-a' })
    expect(mocks.invalidate).toHaveBeenCalledWith('/mcp-servers')
    expect(mocks.toastSuccess).toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('surfaces an IPC removal failure without refreshing, reporting success, or navigating', async () => {
    currentSearch = {}
    currentServer = { id: 'server-a', name: 'Server A', type: 'stdio', command: 'server-a', isActive: false }
    mocks.confirm.mockResolvedValue(true)
    mocks.request.mockImplementation((channel: string) =>
      channel === 'mcp.server.remove' ? Promise.reject(new Error('close failed')) : Promise.resolve([])
    )

    const user = userEvent.setup()
    render(<McpSettings />)
    await user.click(screen.getByRole('button', { name: /common\.delete/ }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(mocks.invalidate).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('does not report a committed delete as failed when the cache refresh rejects', async () => {
    currentSearch = {}
    currentServer = { id: 'server-a', name: 'Server A', type: 'stdio', command: 'server-a', isActive: false }
    mocks.confirm.mockResolvedValue(true)
    mocks.request.mockResolvedValue(undefined)
    mocks.invalidate.mockRejectedValue(new Error('refetch failed'))

    const user = userEvent.setup()
    render(<McpSettings />)
    await user.click(screen.getByRole('button', { name: /common\.delete/ }))

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/mcp' }))
    expect(mocks.toastSuccess).toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
