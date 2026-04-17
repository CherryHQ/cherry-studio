import FileManager from '@renderer/services/FileManager'
import i18next from 'i18next'

import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import { runPainting } from '../../model/services/paintingGenerationService'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils'
import type { GenerateContext } from '../types'
import TokenFluxService from './service'

export async function generateWithTokenFlux(ctx: GenerateContext<TokenFluxPainting>) {
  const {
    input: { painting, provider, abortController },
    writers: { patchPainting, setFallbackUrls }
  } = ctx

  await checkProviderEnabled(provider)

  if (painting.files.length > 0) {
    const confirmed = await window.modal.confirm({
      content: i18next.t('paintings.regenerate.confirm'),
      centered: true
    })
    if (!confirmed) return
    await FileManager.deleteFiles(painting.files)
  }

  const prompt = painting.prompt || ''

  if (!painting.model || !prompt) {
    throw createPaintingGenerateError('TEXT_DESC_REQUIRED')
  }

  const modelId = painting.model

  await runPainting(ctx, async () => {
    try {
      const tokenFluxService = new TokenFluxService(provider.apiHost, provider.apiKey)
      const formData = painting.inputParams || {}
      const requestBody = {
        model: modelId,
        input: {
          prompt,
          ...formData
        }
      }

      const inputParams = { prompt, ...formData }
      patchPainting({
        model: modelId,
        prompt,
        generationStatus: 'processing',
        inputParams
      })

      const result = await tokenFluxService.generateAndWait(requestBody, {
        signal: abortController.signal,
        onStatusUpdate: (updates) => {
          patchPainting(updates)
        }
      })

      if (result?.images && result.images.length > 0) {
        const urls = result.images.map((img: { url: string }) => img.url)
        const validFiles = await tokenFluxService.downloadImages(urls)
        patchPainting({ generationStatus: 'succeeded' })
        setFallbackUrls(urls)
        return { files: validFiles }
      }

      return undefined
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        patchPainting({ generationStatus: 'cancelled' })
      }
      throw error
    }
  })
}
