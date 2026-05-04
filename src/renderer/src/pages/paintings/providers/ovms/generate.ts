import { createPaintingGenerateError } from '../../model/paintingGenerateError'
import { runPainting } from '../../model/paintingGenerationService'
import type { OvmsPaintingData } from '../../model/types/paintingData'
import type { GenerateInput } from '../types'

export async function generateWithOvms(input: GenerateInput<OvmsPaintingData>) {
  const { painting, provider, abortController } = input

  if (!painting.model || !painting.prompt) return []

  return runPainting(async () => {
    const requestBody = {
      model: painting.model,
      prompt: painting.prompt,
      size: painting.size || '512x512',
      num_inference_steps: painting.num_inference_steps || 4,
      rng_seed: painting.rng_seed || 0
    }

    const response = await fetch(`${provider.apiHost}images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: abortController.signal
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }))
      throw createPaintingGenerateError('REMOTE_ERROR', {
        message: errorData.error?.message || 'Image generation failed'
      })
    }

    const data = await response.json()

    if (data.data && data.data.length > 0) {
      const base64s = data.data.filter((item: any) => item.b64_json).map((item: any) => item.b64_json)
      if (base64s.length > 0) {
        return { base64s }
      }

      const urls = data.data.filter((item: any) => item.url).map((item: any) => item.url)
      if (urls.length > 0) {
        return { urls }
      }
    }

    return undefined
  })
}
