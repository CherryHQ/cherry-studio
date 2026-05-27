import { createPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'
import { readErrorMessage } from '@renderer/aiCore/errors/readErrorMessage'

import type { ImageGenerationSubmitInput, ImageGenerationTransport } from '../imageGenerationModel'

/**
 * DMXAPI single-shot transport.
 *
 * Relocated verbatim from the legacy painting service
 * (`src/renderer/src/pages/paintings/providers/dmxapi/generate.ts`):
 * V1 JSON `${apiHost}/v1/images/generations` vs V2 FormData
 * `${apiHost}/v1/images/edits` (edit/merge, multi-image — except the
 * `seededit-3.0` model which stays V1), Bearer auth + DMXAPI User-Agent,
 * `extend_params` passthrough, seed `-1` sentinel, `style_type` prompt-prepend,
 * V1 inline base64 image / V2 FormData blobs, response `data.data[{url,b64_json}]`
 * → urls or `data:` strings. DMXAPI responds synchronously with the finished
 * images, so this transport only implements `submit()`.
 */

export const DEFAULT_DMXAPI_BASE_URL = 'https://www.dmxapi.com'

/** Edit/merge modes route to the V2 `/v1/images/edits` FormData endpoint. */
const EDIT_OR_MERGE_MODES = new Set(['edit', 'merge'])

interface NormalizedInput {
  prompt: string
  n: number
  size: string | undefined
  seed: number | undefined
}

/**
 * DMXAPI painting fields forwarded through `providerOptions['dmxapi']`.
 * Mirrors the `DmxapiPaintingData` subset the legacy `prepare*Request`
 * consumed. `imageFiles` are the relocated `getDmxapiFileMap()` blobs (with
 * their original MIME type preserved so the V1 inline-base64 / V2 FormData
 * branches stay byte-identical to the bespoke service).
 */
export interface DmxapiTransportFile {
  mediaType: string
  data: Uint8Array
  name?: string
}

/**
 * Vendor-specific fields forwarded through `providerOptions.dmxapi`. AI SDK
 * native fields (size / n / seed / prompt) source from `input.*` at submit
 * entry, not from this bag — canonicalGenerate's POSITIONAL_RENAME +
 * AI_SDK_NATIVE_KEYS partition puts them on the AI SDK call options instead.
 */
export interface DmxapiProviderParams {
  model?: string
  mode?: string
  extendParams?: Record<string, unknown>
  imageFiles?: DmxapiTransportFile[]
}

export interface DmxapiTransportSettings {
  apiKey: string
  baseURL?: string
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

class DmxapiTransport implements ImageGenerationTransport {
  private apiKey: string
  private baseURL: string

  constructor(settings: DmxapiTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_DMXAPI_BASE_URL
  }

  private prepareV1Request(input: NormalizedInput, params: DmxapiProviderParams) {
    const body: Record<string, any> = {
      prompt: input.prompt,
      model: params.model,
      n: input.n,
      ...params.extendParams
    }

    if (input.size) body.size = input.size
    if (input.seed !== undefined) {
      body.seed = Number.isFinite(input.seed) && input.seed >= -1 ? input.seed : -1
    }

    const files = params.imageFiles ?? []
    if (files.length > 0) {
      const file = files[0]
      body.image = `data:${file.mediaType || 'application/octet-stream'};base64,${uint8ToBase64(file.data)}`
    }

    return {
      body: JSON.stringify(body),
      headerExpand: { 'Content-Type': 'application/json' } as Record<string, string>,
      endpoint: `${this.baseURL}/v1/images/generations`
    }
  }

  private prepareV2Request(input: NormalizedInput, params: DmxapiProviderParams) {
    const body: Record<string, any> = {
      prompt: input.prompt,
      n: input.n,
      model: params.model,
      ...params.extendParams
    }

    if (input.size) body.size = input.size

    const formData = new FormData()
    for (const key in body) {
      formData.append(key, body[key])
    }

    const files = params.imageFiles ?? []
    files.forEach((file) => {
      const blob = new Blob([file.data as BlobPart], { type: file.mediaType || 'application/octet-stream' })
      formData.append('image', blob, file.name)
    })

    return {
      body: formData as unknown as BodyInit,
      headerExpand: undefined,
      endpoint: `${this.baseURL}/v1/images/edits`
    }
  }

  private prepareRequestConfig(input: NormalizedInput, params: DmxapiProviderParams) {
    const isEditOrMerge = EDIT_OR_MERGE_MODES.has(params.mode ?? '')

    if (isEditOrMerge && params.model !== 'seededit-3.0') {
      return this.prepareV2Request(input, params)
    }
    return this.prepareV1Request(input, params)
  }

  async submit(input: ImageGenerationSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const params = input.providerParams as DmxapiProviderParams
    const normalized: NormalizedInput = {
      prompt: input.prompt ?? '',
      n: input.n,
      size: input.size,
      seed: input.seed
    }

    const requestConfig = this.prepareRequestConfig(normalized, params)

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': 'DMXAPI/1.0.0 (https://www.dmxapi.com)',
      ...requestConfig.headerExpand
    }

    const response = await fetch(requestConfig.endpoint, {
      method: 'POST',
      headers,
      body: requestConfig.body,
      signal: input.signal
    })

    if (!response.ok) {
      if (response.status === 401) throw createPaintingGenerateError('REQ_ERROR_TOKEN')
      if (response.status === 403) throw createPaintingGenerateError('REQ_ERROR_NO_BALANCE')
      const message = await readErrorMessage(response, 'paintings.generate_failed')
      throw createPaintingGenerateError('REMOTE_ERROR', { message })
    }

    const data = await response.json()
    const items = Array.isArray(data?.data) ? data.data : []
    const imageUrls = items
      .map((item: { url?: string; b64_json?: string }) => {
        if (item.b64_json) return 'data:image/png;base64,' + item.b64_json
        if (item.url) return item.url
        return ''
      })
      .filter((url: string) => url.length > 0)

    return { imageUrls }
  }
}

export function createDmxapiTransport(settings: DmxapiTransportSettings): DmxapiTransport {
  return new DmxapiTransport(settings)
}

export type { DmxapiTransport }
