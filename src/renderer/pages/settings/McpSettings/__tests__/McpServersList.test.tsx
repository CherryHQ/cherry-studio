import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { ProtocolMcpInstallRequest, ProtocolMcpServerInstall } from '@shared/data/types/mcpProtocolInstall'
import type { McpServer } from '@shared/data/types/mcpServer'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import McpServersList from '../McpServersList'

const mocks = vi.hoisted(() => ({
  addMcpServer: vi.fn(),
  addMcpServers: vi.fn(),
  ipcRequest: vi.fn(),
  navigate: vi.fn(),
  pendingProtocolInstalls: [] as ProtocolMcpInstallRequest[],
  protocolInstallRequestId: 'request-1'
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useDndReorder: () => ({ onSortEnd: vi.fn() })
  }
})

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({
    mcpServers: [],
    addMcpServer: mocks.addMcpServer,
    addMcpServers: mocks.addMcpServers,
    reorderMcpServers: vi.fn()
  })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => ({
    protocolInstallRequestId: mocks.protocolInstallRequestId
  })
}))

vi.mock('@renderer/components/CollapsibleSearchBar', () => ({ default: () => null }))
vi.mock('@renderer/pages/settings/DependenciesSettings/EnvironmentDependencies', () => ({ default: () => null }))
vi.mock('../AddMcpServerModal', () => ({ default: () => null }))
vi.mock('../QuickCreateMcpServerDialog', () => ({ default: () => null }))
vi.mock('../McpServerCard', () => ({ default: () => null }))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

const protocolServers: ProtocolMcpServerInstall[] = [
  {
    name: 'first-server',
    command: 'npx',
    installSource: 'protocol',
    isActive: false,
    isTrusted: false,
    installedAt: 1
  },
  {
    name: 'second-server',
    command: 'uvx',
    installSource: 'protocol',
    isActive: false,
    isTrusted: false,
    installedAt: 2
  }
]

describe('McpServersList protocol install', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.protocolInstallRequestId = 'request-1'
    mocks.pendingProtocolInstalls = [{ requestId: 'request-1', servers: protocolServers }]
    mocks.ipcRequest.mockImplementation(async () => {
      const requests = mocks.pendingProtocolInstalls
      mocks.pendingProtocolInstalls = []
      return requests
    })
    mocks.addMcpServers.mockImplementation(async (dtos: CreateMcpServerDto[]) =>
      dtos.map((dto) => ({ ...dto, id: `${dto.name}-id` }) as McpServer)
    )
  })

  it('waits for install confirmation, creates in order, and requests run confirmation for the last server', async () => {
    const user = userEvent.setup()
    render(<McpServersList />)

    expect(await screen.findByText('first-server')).toBeInTheDocument()
    expect(screen.getByText('second-server')).toBeInTheDocument()
    expect(mocks.addMcpServers).not.toHaveBeenCalled()
    expect(mocks.ipcRequest).toHaveBeenCalledWith('mcp.protocol_install.consume_pending')

    await user.click(screen.getByRole('button', { name: 'settings.mcp.install' }))

    await waitFor(() => expect(mocks.addMcpServers).toHaveBeenCalledOnce())
    expect(mocks.addMcpServers).toHaveBeenCalledWith(protocolServers)
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/settings/mcp/settings/$serverId',
      params: { serverId: 'second-server-id' },
      search: { autoEnable: 'true' }
    })
  })

  it('queues a second request until the first preview is closed', async () => {
    const user = userEvent.setup()
    let resolveInstall!: (servers: McpServer[]) => void
    mocks.addMcpServers.mockImplementationOnce(
      () =>
        new Promise<McpServer[]>((resolve) => {
          resolveInstall = resolve
        })
    )
    const { rerender } = render(<McpServersList />)

    expect(await screen.findByText('first-server')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'settings.mcp.install' }))
    await waitFor(() => expect(mocks.addMcpServers).toHaveBeenCalledOnce())

    mocks.pendingProtocolInstalls = [
      {
        requestId: 'request-2',
        servers: [
          {
            name: 'queued-server',
            command: 'node',
            installSource: 'protocol',
            isActive: false,
            isTrusted: false,
            installedAt: 3
          }
        ]
      }
    ]
    mocks.protocolInstallRequestId = 'request-2'
    rerender(<McpServersList />)

    expect(screen.queryByText('queued-server')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledTimes(2))
    await act(async () => {
      resolveInstall(protocolServers.map((server) => ({ ...server, id: `${server.name}-id` }) as McpServer))
    })
    expect(await screen.findByText('queued-server')).toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '/settings/mcp/settings/$serverId' }))

    await user.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/settings/mcp/settings/$serverId',
      params: { serverId: 'second-server-id' },
      search: { autoEnable: 'true' }
    })
  })
})
