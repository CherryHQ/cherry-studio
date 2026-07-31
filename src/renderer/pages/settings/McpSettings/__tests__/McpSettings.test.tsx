import type * as CherryStudioUi from '@cherrystudio/ui'
import type { McpServer } from '@shared/data/types/mcpServer'
import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import McpSettings from '../McpSettings'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const mocks = vi.hoisted(() => ({
  confirm: vi.fn().mockResolvedValue(false),
  navigate: vi.fn(),
  request: vi.fn(),
  updateMcpServer: vi.fn().mockResolvedValue(undefined)
}))

const server: McpServer = {
  id: 'protocol-server-id',
  name: 'protocol-server',
  type: 'stdio',
  command: 'printf',
  args: ['deeplink-test'],
  installSource: 'protocol',
  isActive: false,
  isTrusted: false
}

vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServer: () => ({
    server,
    isLoading: false,
    updateMcpServer: mocks.updateMcpServer,
    deleteMcpServer: vi.fn()
  })
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ serverId: server.id }),
  useSearch: () => ({ autoEnable: 'true' })
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
    McpIdentityFields: () => null,
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

describe('McpSettings protocol auto-enable', () => {
  it('consumes the request and shows the run confirmation once without enabling when canceled', async () => {
    render(<McpSettings />)

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'settings.mcp.protocolInstallWarning.title' })
    )
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/settings/mcp/settings/$serverId',
      params: { serverId: server.id },
      search: {},
      replace: true
    })
    expect(mocks.updateMcpServer).not.toHaveBeenCalled()
  })
})
