import { APICallError } from '@ai-sdk/provider'
import { combineHeaders, type FetchFunction, removeUndefinedEntries } from '@ai-sdk/provider-utils'

export interface MinimaxVoiceDesignOptions {
  prompt: string
  previewText: string
  voiceId: string
}

export interface MinimaxVoiceDesignResult {
  voiceId: string
}

export interface MinimaxVoiceDesignConfig {
  url: (options: { path: string }) => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
}

interface MinimaxVoiceDesignResponse {
  voice_id?: string
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

export class MinimaxVoiceDesign {
  constructor(private readonly config: MinimaxVoiceDesignConfig) {}

  async design(options: MinimaxVoiceDesignOptions): Promise<MinimaxVoiceDesignResult> {
    const url = this.config.url({ path: '/voice_design' })
    const body = { prompt: options.prompt, preview_text: options.previewText, voice_id: options.voiceId }
    const headers = removeUndefinedEntries(
      combineHeaders(this.config.headers(), { 'Content-Type': 'application/json' })
    )
    const fetchFn = this.config.fetch ?? globalThis.fetch
    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
    const headersRecord = responseHeaders(response)
    const responseBody = await response.text()

    let parsed: MinimaxVoiceDesignResponse
    try {
      parsed = JSON.parse(responseBody) as MinimaxVoiceDesignResponse
    } catch (cause) {
      throw new APICallError({
        message: responseBody || response.statusText,
        cause,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders: headersRecord,
        responseBody
      })
    }

    const statusCode = parsed.base_resp?.status_code
    if (!response.ok || statusCode !== 0) {
      throw new APICallError({
        message: parsed.base_resp?.status_msg || response.statusText,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders: headersRecord,
        responseBody
      })
    }
    if (!parsed.voice_id) {
      throw new Error('MiniMax voice design response did not include a voice ID')
    }

    return { voiceId: parsed.voice_id }
  }
}
