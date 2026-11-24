import type { ImageModelV2 } from '@ai-sdk/provider'
import { MockProviderV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'

import { RuntimeExecutor } from '../executor'
import type { RuntimeProviderCallEvent } from '../types'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('V2 image model compatibility', () => {
  it.each([false, true])('generates images with receiver-dependent batching and observer=%s', async (observe) => {
    const model: ImageModelV2 & { batchLimit: number; calls: Array<{ prompt: string; n: number }> } = {
      specificationVersion: 'v2',
      provider: 'legacy',
      modelId: 'legacy-image',
      batchLimit: 1,
      calls: [],
      maxImagesPerCall() {
        return this.batchLimit
      },
      async doGenerate({ prompt, n }) {
        this.calls.push({ prompt, n })

        return {
          images: Array.from({ length: n }, () => PNG),
          warnings: [],
          response: { timestamp: new Date(0), modelId: this.modelId, headers: undefined }
        }
      }
    }
    const events: RuntimeProviderCallEvent[] = []
    const executor = new RuntimeExecutor({
      providerId: 'openai',
      provider: new MockProviderV3({}),
      providerSettings: {},
      plugins: [{ name: 'legacy-image', resolveModel: () => model }]
    })
    const result = await executor.generateImage({
      model: 'legacy-image',
      prompt: 'A small image',
      n: 3,
      maxRetries: 0,
      onProviderCall: observe
        ? (event) => {
            events.push(event)
          }
        : undefined
    })

    expect(result.images.map((image) => image.base64)).toEqual([PNG, PNG, PNG])
    expect(model.calls).toEqual([
      { prompt: 'A small image', n: 1 },
      { prompt: 'A small image', n: 1 },
      { prompt: 'A small image', n: 1 }
    ])
    expect(events.map((event) => ({ modality: event.modality, modelId: event.modelId }))).toEqual(
      observe
        ? [
            { modality: 'image', modelId: 'legacy-image' },
            { modality: 'image', modelId: 'legacy-image' },
            { modality: 'image', modelId: 'legacy-image' }
          ]
        : []
    )
  })
})
