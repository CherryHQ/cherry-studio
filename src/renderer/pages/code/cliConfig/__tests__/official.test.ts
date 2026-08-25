import { beforeEach, describe, expect, it, vi } from 'vitest'

import { activateMiniMaxCodeOfficial } from '../official'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

describe('activateMiniMaxCodeOfficial', () => {
  beforeEach(() => {
    mocks.request.mockReset()
  })

  it('uses the dedicated main-process boundary', async () => {
    mocks.request.mockResolvedValue({ success: true })

    await activateMiniMaxCodeOfficial()

    expect(mocks.request).toHaveBeenCalledWith('code_cli.mcode_provider.activate_official')
  })

  it('propagates a failed activation', async () => {
    mocks.request.mockResolvedValue({ success: false, message: 'not logged in' })

    await expect(activateMiniMaxCodeOfficial()).rejects.toThrow('not logged in')
  })
})
