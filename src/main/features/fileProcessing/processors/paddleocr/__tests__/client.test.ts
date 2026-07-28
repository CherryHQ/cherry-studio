import { describe, expect, it, vi } from 'vitest'

describe('createPaddleClient', () => {
  it('defers SDK loading until runtime and surfaces a clear error when the SDK is unavailable', async () => {
    vi.resetModules()
    vi.doMock('@paddleocr/api-sdk', () => {
      throw new Error('Cannot find module @paddleocr/api-sdk')
    })

    const clientModule = await import('../client')

    await expect(clientModule.createPaddleClient('https://paddleocr.aistudio-app.com', 'secret-key')).rejects.toThrow(
      'PaddleOCR SDK is unavailable at runtime'
    )
  })
})
