import { beforeEach, describe, expect, it, vi } from 'vitest'

import { copyApiKeyToClipboard } from '../copyApiKeyToClipboard'

const loggerWarnMock = vi.fn()

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: loggerWarnMock
    })
  }
}))

describe('copyApiKeyToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
    window.toast = {
      success: vi.fn(),
      error: vi.fn()
    } as unknown as typeof window.toast
  })

  it('shows success feedback after copying', async () => {
    await copyApiKeyToClipboard('sk-test', (key) => key)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sk-test')
    expect(window.toast.success).toHaveBeenCalledWith('message.copied')
  })

  it('shows error feedback when copying fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('copy failed'))

    await copyApiKeyToClipboard('sk-test', (key) => key)

    expect(loggerWarnMock).toHaveBeenCalledWith('Failed to copy API key to clipboard', expect.any(Error))
    expect(window.toast.error).toHaveBeenCalledWith('common.copy_failed')
  })
})
