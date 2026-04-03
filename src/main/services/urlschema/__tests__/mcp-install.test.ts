import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendMock = vi.fn()
const showMock = vi.fn()

vi.mock('../../WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => ({
      isDestroyed: vi.fn(() => false),
      show: showMock,
      webContents: {
        send: sendMock
      }
    }))
  }
}))

vi.mock('@shared/IpcChannel', () => ({
  IpcChannel: {
    Mcp_AddServer: 'mcp:add-server'
  }
}))

vi.mock('@reduxjs/toolkit', async () => ({
  nanoid: vi.fn(() => 'generated-id')
}))

describe('handleMcpProtocolUrl', () => {
  beforeEach(() => {
    sendMock.mockClear()
    showMock.mockClear()
  })

  it('ignores malformed protocol payloads instead of throwing', async () => {
    const { handleMcpProtocolUrl } = await import('../mcp-install')
    const url = new URL(`cherrystudio://mcp/install?servers=${Buffer.from('not-json', 'utf8').toString('base64')}`)

    expect(() => handleMcpProtocolUrl(url)).not.toThrow()
    expect(sendMock).not.toHaveBeenCalled()
    expect(showMock).toHaveBeenCalledTimes(1)
  })

  it('skips invalid servers in mixed payloads while installing valid ones', async () => {
    const { handleMcpProtocolUrl } = await import('../mcp-install')
    const payload = {
      mcpServers: {
        valid: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-everything']
        },
        invalidString: 'oops',
        invalidEnvType: {
          command: 'npx',
          env: {
            TOKEN: 123
          }
        }
      }
    }
    const url = new URL(
      `cherrystudio://mcp/install?servers=${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`
    )

    handleMcpProtocolUrl(url)

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith(
      'mcp:add-server',
      expect.objectContaining({
        id: 'generated-id',
        name: 'valid',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything'],
        installSource: 'protocol',
        isTrusted: false,
        isActive: false,
        trustedAt: undefined
      })
    )
    expect(showMock).toHaveBeenCalledTimes(1)
  })
})
