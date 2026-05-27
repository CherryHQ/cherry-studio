import type { DmxapiPainting, FileMetadata, Provider } from '@renderer/types'
import { generationModeType } from '@renderer/types'
import { convertToBase64 } from '@renderer/utils'

import type { PaintingGenerationResult } from '../types'

type DmxapiFileMap = {
  imageFiles?: FileMetadata[]
}

type DmxapiRequestConfig = {
  endpoint: string
  body: BodyInit
  headerExpand?: Record<string, string>
}

type GenerateDmxapiImagesOptions = {
  provider: Provider
  painting: DmxapiPainting
  prompt: string
  fileMap: DmxapiFileMap
  stylePromptPrefix: string
  signal: AbortSignal
}

type DmxapiImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
}

type DmxapiRequestParams = Record<string, unknown> & {
  prompt: string
  model?: string
  n?: number
}

const appendFormValue = (formData: FormData, key: string, value: unknown) => {
  if (value === undefined || value === null) {
    return
  }

  formData.append(key, value instanceof Blob ? value : String(value))
}

const applyDmxapiCommonParams = (params: DmxapiRequestParams, painting: DmxapiPainting, stylePromptPrefix: string) => {
  if (painting.image_size) {
    params.size = painting.image_size
  }

  if (painting.style_type) {
    params.prompt = params.prompt + stylePromptPrefix + painting.style_type
  }

  return params
}

async function buildDmxapiV1GenerateRequest({
  provider,
  prompt,
  painting,
  fileMap,
  stylePromptPrefix
}: Omit<GenerateDmxapiImagesOptions, 'signal'>): Promise<DmxapiRequestConfig> {
  const params = applyDmxapiCommonParams(
    {
      prompt,
      model: painting.model,
      n: painting.n,
      ...painting.extend_params
    },
    painting,
    stylePromptPrefix
  )

  if (painting.seed) {
    params.seed = Number(painting.seed) >= -1 ? Number(painting.seed) : -1
  }

  const imageFile = fileMap.imageFiles?.[0]
  if (imageFile instanceof File) {
    params.image = await convertToBase64(imageFile)
  }

  return {
    body: JSON.stringify(params),
    headerExpand: {
      'Content-Type': 'application/json'
    },
    endpoint: `${provider.apiHost}/v1/images/generations`
  }
}

function buildDmxapiV2GenerateRequest({
  provider,
  prompt,
  painting,
  fileMap,
  stylePromptPrefix
}: Omit<GenerateDmxapiImagesOptions, 'signal'>): DmxapiRequestConfig {
  const params = applyDmxapiCommonParams(
    {
      prompt,
      n: painting.n,
      model: painting.model,
      ...painting.extend_params
    },
    painting,
    stylePromptPrefix
  )

  const formData = new FormData()

  for (const key in params) {
    appendFormValue(formData, key, params[key])
  }

  fileMap.imageFiles?.forEach((file) => {
    formData.append('image', file as unknown as Blob)
  })

  return {
    body: formData,
    endpoint: `${provider.apiHost}/v1/images/edits`
  }
}

async function buildDmxapiRequestConfig(
  options: Omit<GenerateDmxapiImagesOptions, 'signal'>
): Promise<DmxapiRequestConfig> {
  const { painting } = options

  if (
    painting.generationMode !== undefined &&
    [generationModeType.MERGE, generationModeType.EDIT].includes(painting.generationMode)
  ) {
    if (painting.model === 'seededit-3.0') {
      return await buildDmxapiV1GenerateRequest(options)
    }

    return buildDmxapiV2GenerateRequest(options)
  }

  return buildDmxapiV1GenerateRequest(options)
}

function parseDmxapiImageResult(data: DmxapiImageResponse): PaintingGenerationResult {
  return {
    urls: (data.data || []).map((item) => {
      if (item.b64_json) {
        return 'data:image/png;base64,' + item.b64_json
      }

      if (item.url) {
        return item.url
      }

      return ''
    }),
    base64s: []
  }
}

async function callDmxapiImageApi(provider: Provider, requestConfig: DmxapiRequestConfig, signal: AbortSignal) {
  const { endpoint, body, headerExpand } = requestConfig

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
      'User-Agent': 'DMXAPI/1.0.0 (https://www.dmxapi.com)',
      ...headerExpand
    },
    body,
    signal
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('paintings.req_error_token')
    }

    if (response.status === 403) {
      throw new Error('paintings.req_error_no_balance')
    }

    throw new Error('paintings.operation_failed')
  }

  return parseDmxapiImageResult((await response.json()) as DmxapiImageResponse)
}

export async function generateDmxapiImages(options: GenerateDmxapiImagesOptions): Promise<PaintingGenerationResult> {
  const requestConfig = await buildDmxapiRequestConfig(options)
  return callDmxapiImageApi(options.provider, requestConfig, options.signal)
}
