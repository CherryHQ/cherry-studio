import type { McpServer } from '@shared/data/types/mcpServer'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import McpServerCard from '../McpServerCard'

const mocks = vi.hoisted(() => ({
  callOrder: [] as string[],
  deleteMcpServer: vi.fn(),
  ensureServerTrusted: vi.fn(),
  ipcRequest: vi.fn(),
  updateMcpServer: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: () => null,
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Switch: ({
    checked,
    disabled,
    onCheckedChange
  }: {
    checked: boolean
    disabled?: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/icons/DeleteIcon', () => ({
  default: () => null
}))

vi.mock('@renderer/components/popups/ContentPopup', () => ({
  default: { show: vi.fn() }
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatus: () => ({ state: 'disabled' })
}))

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServerMutations: () => ({
    deleteMcpServer: mocks.deleteMcpServer,
    updateMcpServer: mocks.updateMcpServer
  })
}))

vi.mock('@renderer/i18n/label', () => ({
  getMcpTypeLabelKey: () => 'settings.mcp.type'
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.ipcRequest(...args)
  }
}))

vi.mock('@renderer/services/popup', () => ({
  popup: {
    confirm: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../useMcpServerTrust', () => ({
  useMcpServerTrust: () => ({
    ensureServerTrusted: mocks.ensureServerTrusted
  })
}))

describe('McpServerCard', () => {
  beforeEach(() => {
    mocks.callOrder = []
    mocks.deleteMcpServer.mockReset().mockResolvedValue(undefined)
    mocks.ensureServerTrusted.mockReset().mockImplementation(async (server: McpServer) => server)
    mocks.updateMcpServer.mockReset().mockResolvedValue(undefined)
    mocks.ipcRequest.mockReset().mockImplementation(async (channel: string) => {
      mocks.callOrder.push(channel)
      return channel === 'mcp.server.get_version' ? '1.0.0' : undefined
    })
  })

  it('finishes an interactive tool refresh before fetching the version on activation', async () => {
    const server = {
      id: 'oauth-server',
      name: 'OAuth server',
      type: 'streamableHttp',
      baseUrl: 'https://example.com/mcp',
      isActive: false
    } as McpServer

    render(<McpServerCard server={server} onEdit={vi.fn()} />)
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledTimes(2))
    expect(mocks.callOrder).toEqual(['mcp.server.refresh_tools', 'mcp.server.get_version'])
    expect(mocks.ipcRequest).toHaveBeenNthCalledWith(1, 'mcp.server.refresh_tools', {
      serverId: server.id,
      interactive: true
    })
  })
})
