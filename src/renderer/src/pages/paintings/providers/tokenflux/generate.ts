import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import { runPainting } from '../../model/services/paintingGenerationService'
import type { TokenFluxPaintingData as TokenFluxPainting } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils'
import type { GenerateInput } from '../types'
import TokenFluxService from './service'

export async function generateWithTokenFlux(input: GenerateInput<TokenFluxPainting>) {
  const { painting, provider, abortController } = input

  const apiKey = await checkProviderEnabled(provider)

  const prompt = painting.prompt || ''

  if (!painting.model || !prompt) {
    throw createPaintingGenerateError('TEXT_DESC_REQUIRED')
  }

  const modelId = painting.model

  return runPainting(async () => {
    const tokenFluxService = new TokenFluxService(provider.apiHost, apiKey)
    const formData = painting.inputParams || {}
    const requestBody = {
      model: modelId,
      input: {
        prompt,
        ...formData
      }
    }

    const result = await tokenFluxService.generateAndWait(requestBody, {
      signal: abortController.signal
    })

    if (result?.images && result.images.length > 0) {
      const urls = result.images.map((img: { url: string }) => img.url)
      return { files: await tokenFluxService.downloadImages(urls) }
    }

    return undefined
  })
}
