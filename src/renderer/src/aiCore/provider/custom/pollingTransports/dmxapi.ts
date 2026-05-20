import i18next from 'i18next'

import { createPaintingGenerateError } from '@renderer/pages/paintings/model/paintingGenerateError'
import { readErrorMessage } from '@renderer/pages/paintings/providers/shared/readErrorMessage'

import type { PollingSubmitInput, PollingTransport } from '../pollingImageModel'

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
 * images, so `submit()` does the one request and `poll()` is never invoked.
 */

export const DEFAULT_DMXAPI_BASE_URL = 'https://www.dmxapi.com'

function createAbortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/** Edit/merge modes route to the V2 `/v1/images/edits` FormData endpoint. */
const EDIT_OR_MERGE_MODES = new Set(['edit', 'merge'])

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

export interface DmxapiProviderParams {
  model?: string
  n?: number
  imageSize?: string
  seed?: string
  styleType?: string
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

class DmxapiTransport implements PollingTransport {
  private apiKey: string
  private baseURL: string

  constructor(settings: DmxapiTransportSettings) {
    this.apiKey = settings.apiKey
    this.baseURL = settings.baseURL || DEFAULT_DMXAPI_BASE_URL
  }

  private prepareV1Request(prompt: string, params: DmxapiProviderParams) {
    const body: Record<string, any> = {
      prompt,
      model: params.model,
      n: params.n,
      ...params.extendParams
    }

    if (params.imageSize) body.size = params.imageSize
    if (params.seed && Number(params.seed) >= -1) {
      body.seed = Number(params.seed)
    } else if (params.seed) {
      body.seed = -1
    }

    if (params.styleType) {
      body.prompt = prompt + i18next.t('paintings.dmxapi.style') + params.styleType
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

  private prepareV2Request(prompt: string, params: DmxapiProviderParams) {
    const body: Record<string, any> = {
      prompt,
      n: params.n,
      model: params.model,
      ...params.extendParams
    }

    if (params.imageSize) body.size = params.imageSize
    if (params.styleType) {
      body.prompt = prompt + ' style: ' + params.styleType
    }

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

  private prepareRequestConfig(prompt: string, params: DmxapiProviderParams) {
    const isEditOrMerge = EDIT_OR_MERGE_MODES.has(params.mode ?? '')

    if (isEditOrMerge && params.model !== 'seededit-3.0') {
      return this.prepareV2Request(prompt, params)
    }
    return this.prepareV1Request(prompt, params)
  }

  async submit(input: PollingSubmitInput): Promise<{ taskId?: string; imageUrls?: string[] }> {
    const params = input.providerParams as DmxapiProviderParams
    const prompt = input.prompt ?? ''

    const requestConfig = this.prepareRequestConfig(prompt, params)

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

  async poll(): Promise<string[]> {
    throw createAbortError('DMXAPI does not support polling')
  }
}

export function createDmxapiTransport(settings: DmxapiTransportSettings): DmxapiTransport {
  return new DmxapiTransport(settings)
}

export type { DmxapiTransport }
