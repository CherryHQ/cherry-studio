import { BaseService } from '@main/core/lifecycle/BaseService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGenerateImage = vi.fn()
const mockDownloadImageAsBase64 = vi.fn()

vi.mock('@main/services/agents/services/channels/ChannelAdapter', () => ({
  downloadImageAsBase64: (...args: unknown[]) => mockDownloadImageAsBase64(...args)
}))

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: vi.fn(),
  embedMany: vi.fn(),
  generateImage: (...args: unknown[]) => mockGenerateImage(...args)
}))

const { AiService } = await import('../AiService')

/**
 * Instantiate `AiService` directly (without going through the lifecycle
 * container) so unit tests can drive its methods in isolation.
 */
function createService(): InstanceType<typeof AiService> {
  BaseService.resetInstances()
  return new (AiService as any)()
}

describe('AiService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('manages the image-request lifecycle: register → abort → remove', () => {
    const service = createService()
    const ctrl = new AbortController()

    // abort() against an unknown id is a no-op (no throw).
    expect(() => service.abort('never-registered')).not.toThrow()

    // register + abort → signal is aborted.
    service.registerRequest('req-1', ctrl)
    service.abort('req-1')
    expect(ctrl.signal.aborted).toBe(true)

    // After removeRequest(), abort() on the same id has no effect —
    // the controller is detached so stray abort calls can't retro-cancel.
    const ctrl2 = new AbortController()
    service.registerRequest('req-2', ctrl2)
    service.removeRequest('req-2')
    service.abort('req-2')
    expect(ctrl2.signal.aborted).toBe(false)
  })

  it('normalizes base64 and url images from ai-core generateImage', async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParams').mockResolvedValue({
      sdkConfig: {
        providerId: 'test-provider',
        providerSettings: {},
        modelId: 'test-model'
      }
    } as never)

    mockGenerateImage.mockResolvedValue({
      images: [{ base64: 'abc123', mediaType: 'image/png' }, { nonsense: true }],
      providerMetadata: {
        testProvider: {
          images: [{ url: 'https://example.com/image.png' }]
        }
      }
    })

    mockDownloadImageAsBase64.mockResolvedValue({
      data: 'url-base64',
      media_type: 'image/jpeg'
    })

    const result = await service.generateImage(
      {
        uniqueModelId: 'test-provider::test-model',
        prompt: 'draw a cat',
        n: 2,
        size: '1024x1024',
        negativePrompt: 'blurry',
        seed: 7,
        quality: 'high',
        numInferenceSteps: 30,
        guidanceScale: 4.5,
        promptEnhancement: true
      },
      new AbortController().signal
    )

    expect(mockGenerateImage).toHaveBeenCalledWith(
      'test-provider',
      {},
      expect.objectContaining({
        model: 'test-model',
        prompt: 'draw a cat',
        n: 2,
        size: '1024x1024',
        negativePrompt: 'blurry',
        seed: 7,
        quality: 'high',
        numInferenceSteps: 30,
        guidanceScale: 4.5,
        promptEnhancement: true
      })
    )

    const callOptions = mockGenerateImage.mock.calls[0]?.[2]
    expect(callOptions.experimental_download).toBeTypeOf('function')

    const downloaded = await callOptions.experimental_download([
      {
        url: new URL('https://example.com/image.png'),
        isUrlSupportedByModel: false
      }
    ])

    expect(mockDownloadImageAsBase64).toHaveBeenCalledWith('https://example.com/image.png')
    expect(downloaded).toEqual([
      {
        data: Buffer.from('url-base64', 'base64'),
        mediaType: 'image/jpeg'
      }
    ])

    expect(result).toEqual({
      images: [{ kind: 'base64', data: 'data:image/png;base64,abc123', mediaType: 'image/png' }]
    })
  })
})
