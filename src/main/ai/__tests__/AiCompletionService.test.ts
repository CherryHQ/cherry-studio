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

import { AiCompletionService } from '../AiCompletionService'
import { ToolRegistry } from '../tools/ToolRegistry'

describe('AiCompletionService', () => {
  const createService = () => new AiCompletionService(new ToolRegistry())

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should manage active requests', () => {
    const service = createService()
    const controller = new AbortController()

    service.registerRequest('req-1', controller)
    service.abort('req-1')

    expect(controller.signal.aborted).toBe(true)
  })

  it('should handle abort for non-existent request gracefully', () => {
    const service = createService()
    service.abort('non-existent')
  })

  it('should remove request after completion', () => {
    const service = createService()
    const controller = new AbortController()

    service.registerRequest('req-1', controller)
    service.removeRequest('req-1')
    service.abort('req-1')
    expect(controller.signal.aborted).toBe(false)
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
