import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CopilotService from '../CopilotService'

function jsonResponse(body: unknown): Awaited<ReturnType<typeof net.fetch>> {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(body)
  } as unknown as Awaited<ReturnType<typeof net.fetch>>
}

describe('CopilotService', () => {
  beforeEach(() => {
    vi.mocked(net.fetch).mockReset()
  })

  it('keeps required authorization headers when custom Copilot headers are provided', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(
      jsonResponse({
        device_code: 'device-code',
        user_code: 'user-code',
        verification_uri: 'https://github.com/login/device'
      })
    )

    await CopilotService.getAuthMessage({} as Electron.IpcMainInvokeEvent, { 'X-Custom': 'value' })

    expect(net.fetch).toHaveBeenCalledWith(
      'https://github.com/login/device/code',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Custom': 'value'
        })
      })
    )
  })
})
