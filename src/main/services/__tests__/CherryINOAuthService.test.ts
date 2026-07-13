import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ReduxService', () => ({
  reduxService: {
    dispatch: vi.fn(),
    select: vi.fn()
  }
}))

import CherryINOAuthService from '../CherryINOAuthService'

function createEvent(senderId: number): Electron.IpcMainInvokeEvent {
  return {
    sender: {
      id: senderId
    }
  } as Electron.IpcMainInvokeEvent
}

function jsonResponse(body: unknown): Awaited<ReturnType<typeof net.fetch>> {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue('')
  } as unknown as Awaited<ReturnType<typeof net.fetch>>
}

describe('CherryINOAuthService', () => {
  beforeEach(() => {
    vi.mocked(net.fetch).mockReset()
  })

  it('exchanges CherryIN OAuth codes from the initiating IPC sender', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'ACCESS_TOKEN',
          refresh_token: 'REFRESH_TOKEN'
        })
      )
      .mockResolvedValueOnce(jsonResponse(['CHERRYIN_API_KEY']))

    const flow = await CherryINOAuthService.startOAuthFlow(createEvent(17), 'https://open.cherryin.ai')
    const result = await CherryINOAuthService.exchangeToken(createEvent(17), 'AUTH_CODE', flow.state)

    expect(result).toEqual({ apiKeys: 'CHERRYIN_API_KEY' })
    expect(net.fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects CherryIN OAuth code exchanges from a different IPC sender', async () => {
    const flow = await CherryINOAuthService.startOAuthFlow(createEvent(17), 'https://open.cherryin.ai')

    await expect(CherryINOAuthService.exchangeToken(createEvent(42), 'AUTH_CODE', flow.state)).rejects.toThrow(
      'OAuth flow was started by a different window'
    )
    expect(net.fetch).not.toHaveBeenCalled()

    vi.mocked(net.fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'ACCESS_TOKEN',
          refresh_token: 'REFRESH_TOKEN'
        })
      )
      .mockResolvedValueOnce(jsonResponse(['CHERRYIN_API_KEY']))

    await expect(CherryINOAuthService.exchangeToken(createEvent(17), 'AUTH_CODE', flow.state)).resolves.toEqual({
      apiKeys: 'CHERRYIN_API_KEY'
    })
  })
})
