import { APICallError } from '@ai-sdk/provider'
import { combineHeaders, type FetchFunction, removeUndefinedEntries } from '@ai-sdk/provider-utils'

const AUDIO_FORMATS = ['mp3', 'm4a', 'wav'] as const
const MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo'
] as const

export type MinimaxVoiceCloneModel = (typeof MODELS)[number]

export interface MinimaxVoiceCloneOptions {
  audio: Blob
  fileName: string
  voiceId: string
  model: MinimaxVoiceCloneModel
}

export interface MinimaxVoiceCloneResult {
  voiceId: string
}

export interface MinimaxVoiceCloningConfig {
  url: (options: { path: string }) => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
}

interface MinimaxResponse {
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

async function parseResponse<T extends MinimaxResponse>(
  response: Response,
  url: string,
  requestBodyValues: Record<string, unknown>
): Promise<{ data: T; responseBody: string }> {
  const headers = responseHeaders(response)
  const responseBody = await response.text()

  let parsed: T
  try {
    parsed = JSON.parse(responseBody) as T
  } catch (cause) {
    throw new APICallError({
      message: responseBody || response.statusText,
      cause,
      url,
      requestBodyValues,
      statusCode: response.status,
      responseHeaders: headers,
      responseBody
    })
  }

  const statusCode = parsed.base_resp?.status_code
  if (!response.ok || statusCode !== 0) {
    throw new APICallError({
      message: parsed.base_resp?.status_msg || response.statusText,
      url,
      requestBodyValues,
      statusCode: response.status,
      responseHeaders: headers,
      responseBody
    })
  }

  return { data: parsed, responseBody }
}

function extractFileId(responseBody: string): string | undefined {
  const fileObject = responseBody.match(/"file"\s*:\s*\{([^{}]*)\}/s)?.[1]
  return fileObject?.match(/"file_id"\s*:\s*(\d+)/)?.[1]
}

export class MinimaxVoiceCloning {
  constructor(private readonly config: MinimaxVoiceCloningConfig) {}

  async clone(options: MinimaxVoiceCloneOptions): Promise<MinimaxVoiceCloneResult> {
    const extension = options.fileName.split('.').pop()?.toLowerCase()
    if (!AUDIO_FORMATS.includes(extension as (typeof AUDIO_FORMATS)[number])) {
      throw new Error(`Unsupported MiniMax voice clone audio format: ${extension || 'unknown'}`)
    }
    if (!MODELS.includes(options.model)) {
      throw new Error(`Unsupported MiniMax voice clone model: ${options.model}`)
    }

    const fetchFn = this.config.fetch ?? globalThis.fetch
    const headers = removeUndefinedEntries(combineHeaders(this.config.headers()))
    const uploadUrl = this.config.url({ path: '/files/upload' })
    const form = new FormData()
    form.append('purpose', 'voice_clone')
    form.append('file', options.audio, options.fileName)

    const uploadResponse = await fetchFn(uploadUrl, { method: 'POST', headers, body: form })
    const upload = await parseResponse<MinimaxResponse>(uploadResponse, uploadUrl, {
      purpose: 'voice_clone',
      fileName: options.fileName
    })
    const fileId = extractFileId(upload.responseBody)
    if (!fileId) {
      throw new Error('MiniMax voice clone upload did not return a file ID')
    }

    const cloneUrl = this.config.url({ path: '/voice_clone' })
    const body = {
      file_id: fileId,
      voice_id: options.voiceId,
      model: options.model
    }
    const requestBody = `{"file_id":${fileId},"voice_id":${JSON.stringify(options.voiceId)},"model":${JSON.stringify(options.model)}}`
    const cloneResponse = await fetchFn(cloneUrl, {
      method: 'POST',
      headers: removeUndefinedEntries(combineHeaders(headers, { 'Content-Type': 'application/json' })),
      body: requestBody
    })
    await parseResponse<MinimaxResponse>(cloneResponse, cloneUrl, body)

    return { voiceId: options.voiceId }
  }
}
