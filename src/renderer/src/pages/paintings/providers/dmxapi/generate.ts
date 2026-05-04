import { convertToBase64 } from '@renderer/utils'
import i18next from 'i18next'

import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import { runPainting } from '../../model/services/paintingGenerationService'
import type { DmxapiPaintingData as DmxapiPainting } from '../../model/types/paintingData'
import { generationModeType } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils'
import type { GenerateInput } from '../types'
import { getDmxapiFileMap } from './runtime'

async function prepareRequestConfig(
  prompt: string,
  painting: DmxapiPainting,
  mode: string,
  provider: { apiHost: string }
) {
  const isEditOrMerge = [generationModeType.EDIT, generationModeType.MERGE].includes(mode as generationModeType)

  if (isEditOrMerge && painting.model !== 'seededit-3.0') {
    return prepareV2Request(prompt, painting, provider)
  }
  return await prepareV1Request(prompt, painting, provider)
}

async function prepareV1Request(prompt: string, painting: DmxapiPainting, provider: { apiHost: string }) {
  const params: Record<string, any> = {
    prompt,
    model: painting.model,
    n: painting.n,
    ...painting.extend_params
  }

  if (painting.image_size) params.size = painting.image_size
  if (painting.seed && Number(painting.seed) >= -1) {
    params.seed = Number(painting.seed)
  } else if (painting.seed) {
    params.seed = -1
  }

  if (painting.style_type) {
    params.prompt = prompt + i18next.t('paintings.dmxapi.style') + painting.style_type
  }

  const fileMap = getDmxapiFileMap()
  if (fileMap.imageFiles.length > 0) {
    const imageFile = fileMap.imageFiles[0]
    if (imageFile instanceof File) {
      params.image = await convertToBase64(imageFile)
    }
  }

  return {
    body: JSON.stringify(params),
    headerExpand: { 'Content-Type': 'application/json' },
    endpoint: `${provider.apiHost}/v1/images/generations`
  }
}

function prepareV2Request(prompt: string, painting: DmxapiPainting, provider: { apiHost: string }) {
  const params: Record<string, any> = {
    prompt,
    n: painting.n,
    model: painting.model,
    ...painting.extend_params
  }

  if (painting.image_size) params.size = painting.image_size
  if (painting.style_type) {
    params.prompt = prompt + ' style: ' + painting.style_type
  }

  const formData = new FormData()
  for (const key in params) {
    formData.append(key, params[key])
  }

  const fileMap = getDmxapiFileMap()
  if (fileMap.imageFiles.length > 0) {
    fileMap.imageFiles.forEach((file) => {
      formData.append('image', file as unknown as Blob)
    })
  }

  return {
    body: formData as any,
    headerExpand: undefined,
    endpoint: `${provider.apiHost}/v1/images/edits`
  }
}

export async function generateWithDmxapi(input: GenerateInput<DmxapiPainting>) {
  const { painting, provider, abortController, tab } = input
  const mode = tab || generationModeType.GENERATION

  const apiKey = await checkProviderEnabled(provider)

  if (!painting.model) {
    throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  }

  if (!painting.prompt) {
    throw createPaintingGenerateError('TEXT_DESC_REQUIRED')
  }

  if (
    [generationModeType.EDIT, generationModeType.MERGE].includes(mode as generationModeType) &&
    getDmxapiFileMap().imageFiles.length === 0
  ) {
    throw createPaintingGenerateError('IMAGE_HANDLE_REQUIRED')
  }

  const prompt = painting.prompt || ''

  return runPainting(async () => {
    const requestConfig = await prepareRequestConfig(prompt, painting, mode, provider)

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': 'DMXAPI/1.0.0 (https://www.dmxapi.com)',
      ...requestConfig.headerExpand
    }

    const response = await fetch(requestConfig.endpoint, {
      method: 'POST',
      headers,
      body: requestConfig.body,
      signal: abortController.signal
    })

    if (!response.ok) {
      if (response.status === 401) throw createPaintingGenerateError('REQ_ERROR_TOKEN')
      if (response.status === 403) throw createPaintingGenerateError('REQ_ERROR_NO_BALANCE')
      throw createPaintingGenerateError('OPERATION_FAILED')
    }

    const data = await response.json()
    const urls = data.data.map((item: { url: string; b64_json: string }) => {
      if (item.b64_json) return 'data:image/png;base64,' + item.b64_json
      if (item.url) return item.url
      return ''
    })

    if (urls.length > 0) {
      return { urls, downloadOptions: { allowBase64DataUrls: true } }
    }

    return undefined
  })
}
