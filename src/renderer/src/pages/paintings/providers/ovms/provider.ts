import { loggerService } from '@logger'
import type { OvmsPainting } from '@renderer/types'
import type { Provider } from '@renderer/types/provider'

const logger = loggerService.withContext('OvmsProvider')

type GenerateOvmsImagesOptions = {
  provider: Provider
  painting: OvmsPainting
  signal: AbortSignal
}

type OvmsImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  error?: { message?: string }
}

function buildOvmsImageRequestBody(painting: OvmsPainting) {
  return {
    model: painting.model,
    prompt: painting.prompt,
    size: painting.size || '512x512',
    num_inference_steps: painting.num_inference_steps || 4,
    rng_seed: painting.rng_seed || 0
  }
}

function parseOvmsImageResponse(data: OvmsImageResponse) {
  const images = data.data || []

  return {
    urls: images.filter((item) => item.url).map((item) => item.url as string),
    base64s: images.filter((item) => item.b64_json).map((item) => item.b64_json as string)
  }
}

export async function generateOvmsImages({ provider, painting, signal }: GenerateOvmsImagesOptions) {
  const requestBody = buildOvmsImageRequestBody(painting)

  logger.info('OVMS API request:', requestBody)

  const response = await fetch(`${provider.apiHost}images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody),
    signal
  })

  const data = (await response
    .json()
    .catch(() => ({ error: { message: `HTTP ${response.status}` } }))) as OvmsImageResponse

  if (!response.ok) {
    logger.error('OVMS API error:', data)
    throw new Error(data.error?.message || 'Image generation failed')
  }

  logger.info('OVMS API response:', data)

  return parseOvmsImageResponse(data)
}
