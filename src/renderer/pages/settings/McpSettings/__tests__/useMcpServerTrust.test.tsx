import { render, renderHook, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpServer } from '@shared/data/types/mcpServer'

import { useMcpServerTrust } from '../useMcpServerTrust'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  ipcRequest: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.ipcRequest
  }
}))

vi.mock('@renderer/services/popup', () => ({
  popup: {
    confirm: mocks.confirm
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('useMcpServerTrust', () => {
  beforeEach(() => {
    mocks.confirm.mockReset()
    mocks.ipcRequest.mockReset()
  })

  it('resolves the effective platform launch config before prompting when enabling a saved package later', async () => {
    mocks.confirm.mockResolvedValue(false)
    mocks.ipcRequest.mockResolvedValue({
      command: 'bun',
      args: ['/pkg/platform.js'],
      env: { USER_SET: '1', OVERRIDE_ENV: '2' }
    })

    const updateServer = vi.fn()
    const { result } = renderHook(() => useMcpServerTrust(updateServer))
    const savedPackage: McpServer = {
      id: 'pkg-1',
      name: 'Saved Package',
      type: 'stdio',
      baseUrl: '',
      command: 'node',
      args: ['/pkg/base.js'],
      env: { USER_SET: '1' },
      dxtPath: '/pkg',
      installSource: 'manual',
      isActive: false,
      isTrusted: false
    }

    await expect(result.current.ensureServerTrusted(savedPackage)).resolves.toBeNull()
    expect(mocks.ipcRequest).toHaveBeenCalledWith('mcp.package.get_resolved_config', { serverId: 'pkg-1' })
    expect(mocks.confirm).toHaveBeenCalledTimes(1)

    const confirmArgs = mocks.confirm.mock.calls[0][0] as { content: ReactElement }
    render(confirmArgs.content)
    expect(screen.getByText('settings.mcp.command')).toBeInTheDocument()
    expect(screen.getByText('bun /pkg/platform.js')).toBeInTheDocument()
    expect(screen.getByText(/OVERRIDE_ENV=2/)).toBeInTheDocument()
  })
})
