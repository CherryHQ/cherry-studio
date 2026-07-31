import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import McpServersList from '../McpServersList'

const mocks = vi.hoisted(() => ({
  addMcpServer: vi.fn(),
  navigate: vi.fn(),
  protocolInstall: [] as CreateMcpServerDto[]
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
    reorderMcpServers: vi.fn()
  })
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => ({ protocolInstall: mocks.protocolInstall })
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

const protocolServers: CreateMcpServerDto[] = [
  {
    name: 'first-server',
    command: 'npx',
    installSource: 'protocol',
    isActive: false,
    isTrusted: false
  },
  {
    name: 'second-server',
    command: 'uvx',
    installSource: 'protocol',
    isActive: false,
    isTrusted: false
  }
]

describe('McpServersList protocol install', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.protocolInstall = protocolServers
    mocks.addMcpServer.mockImplementation(async (dto: CreateMcpServerDto) => {
      return { ...dto, id: `${dto.name}-id` } as McpServer
    })
  })

  it('waits for install confirmation, creates in order, and requests run confirmation for the last server', async () => {
    const user = userEvent.setup()
    render(<McpServersList />)

    expect(await screen.findByText('first-server')).toBeInTheDocument()
    expect(screen.getByText('second-server')).toBeInTheDocument()
    expect(mocks.addMcpServer).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/mcp/servers', search: {}, replace: true })

    await user.click(screen.getByRole('button', { name: 'settings.mcp.install' }))

    await waitFor(() => expect(mocks.addMcpServer).toHaveBeenCalledTimes(2))
    expect(mocks.addMcpServer.mock.calls.map(([server]) => server.name)).toEqual(['first-server', 'second-server'])
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/settings/mcp/settings/$serverId',
      params: { serverId: 'second-server-id' },
      search: { autoEnable: 'true' }
    })
  })
})
