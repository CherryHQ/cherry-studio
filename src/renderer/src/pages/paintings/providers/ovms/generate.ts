import FileManager from '@renderer/services/FileManager'
import i18next from 'i18next'

import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import { processPaintingResult, runPainting } from '../../model/services/paintingGenerationService'
import type { OvmsPaintingData as PaintingData } from '../../model/types/paintingData'
import type { GenerateContext } from '../types'

export async function generateWithOvms(ctx: GenerateContext) {
  const {
    input: { painting, provider, abortController },
    writers: { patchPainting }
  } = ctx

  if (painting.files.length > 0) {
    const confirmed = await window.modal.confirm({
      content: i18next.t('paintings.regenerate.confirm'),
      centered: true
    })
    if (!confirmed) return
    await FileManager.deleteFiles(painting.files)
  }

  const prompt = painting.prompt || ''
  patchPainting({ prompt } as Partial<PaintingData>)

  if (!painting.model || !painting.prompt) return

  await runPainting(ctx, async () => {
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
        await processPaintingResult(ctx, { base64s })
      }

      const urls = data.data.filter((item: any) => item.url).map((item: any) => item.url)
      if (urls.length > 0) {
        await processPaintingResult(ctx, { urls })
      }
    }

    return undefined
  })
}
