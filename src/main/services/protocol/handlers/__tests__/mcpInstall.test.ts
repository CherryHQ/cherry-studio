import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ipcApiServiceMock, mainWindowServiceMock } = vi.hoisted(() => ({
  ipcApiServiceMock: {
    broadcastToType: vi.fn()
  },
  mainWindowServiceMock: {
    showMainWindow: vi.fn()
  }
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'IpcApiService') return ipcApiServiceMock
      if (name === 'MainWindowService') return mainWindowServiceMock
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('nanoid', () => ({
  nanoid: () => 'generated-id'
}))

import { WindowType } from '@main/core/window/types'

import { handleMcpProtocolUrl } from '../mcpInstall'

describe('mcpInstall protocol handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves standard base64 plus characters through URL parsing', () => {
    const config = {
      mcpServers: {
        demo: {
          command: 'npx',
          args: ['-y', `pkg-${String.fromCodePoint(0x1f600)}`]
        }
      }
    }
    const data = Buffer.from(JSON.stringify(config), 'utf-8').toString('base64')

    expect(data).toContain('+')

    handleMcpProtocolUrl(new URL(`cherrystudio://mcp/install?servers=${data}`))

    expect(ipcApiServiceMock.broadcastToType).toHaveBeenCalledWith(WindowType.Main, 'mcp.server.added', {
      id: 'generated-id',
      name: 'demo',
      command: 'npx',
      args: ['-y', `pkg-${String.fromCodePoint(0x1f600)}`],
      installSource: 'protocol',
      isTrusted: false,
      isActive: false,
      trustedAt: undefined,
      installedAt: expect.any(Number)
    })
    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledTimes(1)
  })
})
