import { APICallError, type SharedV3Warning, type SpeechModelV3, type SpeechModelV3CallOptions } from '@ai-sdk/provider'
import { combineHeaders, type FetchFunction, removeUndefinedEntries } from '@ai-sdk/provider-utils'

export interface MinimaxSpeechModelConfig {
  provider: string
  url: (options: { modelId: string; path: string }) => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
  _internal?: {
    currentDate?: () => Date
  }
}

interface MinimaxSpeechResponse {
  data?: {
    audio?: string
    status?: number
  }
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'pcm'] as const

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

function decodeHexAudio(value: string): Uint8Array {
  const hex = value.trim()
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error('MiniMax returned invalid hex audio data')
  }

  const audio = new Uint8Array(hex.length / 2)
  for (let index = 0; index < audio.length; index += 1) {
    audio[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return audio
}

export class MinimaxSpeechModel implements SpeechModelV3 {
  readonly specificationVersion = 'v3'

  get provider(): string {
    return this.config.provider
  }

  constructor(
    readonly modelId: string,
    private readonly config: MinimaxSpeechModelConfig
  ) {}

  async doGenerate(options: SpeechModelV3CallOptions): Promise<Awaited<ReturnType<SpeechModelV3['doGenerate']>>> {
    const currentDate = this.config._internal?.currentDate?.() ?? new Date()
    const { text, voice, outputFormat, instructions, speed, language, providerOptions, headers, abortSignal } = options
    const bag = asRecord(providerOptions?.minimax ?? providerOptions?.['minimax-global'])
    const warnings: SharedV3Warning[] = []

    const body: Record<string, unknown> = {
      model: this.modelId,
      text,
      stream: typeof bag.stream === 'boolean' ? bag.stream : false,
      output_format: 'hex'
    }

    const languageBoost = language ?? bag.language_boost
    if (languageBoost !== undefined && languageBoost !== null) body.language_boost = languageBoost

    for (const key of ['pronunciation_dict', 'voice_modify', 'subtitle_enable'] as const) {
      if (bag[key] !== undefined && bag[key] !== null) body[key] = bag[key]
    }

    const voiceSetting = asRecord(bag.voice_setting)
    if (voice !== undefined) voiceSetting.voice_id = voice
    if (speed !== undefined) voiceSetting.speed = speed
    if (Object.keys(voiceSetting).length > 0) body.voice_setting = voiceSetting

    const audioSetting = asRecord(bag.audio_setting)
    if (outputFormat !== undefined) {
      if ((AUDIO_FORMATS as readonly string[]).includes(outputFormat)) {
        audioSetting.format = outputFormat
      } else {
        warnings.push({
          type: 'unsupported',
          feature: 'outputFormat',
          details: `Unsupported MiniMax audio format: ${outputFormat}.`
        })
      }
    }
    if (Object.keys(audioSetting).length > 0) body.audio_setting = audioSetting

    if (instructions !== undefined) {
      warnings.push({
        type: 'unsupported',
        feature: 'instructions',
        details: 'MiniMax speech does not expose an instructions request field.'
      })
    }

    const url = this.config.url({ path: '/t2a_v2', modelId: this.modelId })
    const fetchFn = this.config.fetch ?? globalThis.fetch
    const response = await fetchFn(url, {
      method: 'POST',
      headers: removeUndefinedEntries(
        combineHeaders(this.config.headers(), headers, { 'Content-Type': 'application/json' })
      ),
      body: JSON.stringify(body),
      signal: abortSignal
    })
    const headersRecord = responseHeaders(response)
    const responseBody = await response.text()

    if (!response.ok) {
      throw new APICallError({
        message: responseBody || response.statusText,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders: headersRecord,
        responseBody
      })
    }

    let parsed: MinimaxSpeechResponse
    try {
      parsed = JSON.parse(responseBody) as MinimaxSpeechResponse
    } catch (cause) {
      throw new APICallError({
        message: 'Invalid JSON response from MiniMax',
        cause,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders: headersRecord,
        responseBody
      })
    }

    const statusCode = parsed.base_resp?.status_code
    if (statusCode !== undefined && statusCode !== 0) {
      throw new APICallError({
        message: parsed.base_resp?.status_msg || `MiniMax error ${statusCode}`,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders: headersRecord,
        responseBody
      })
    }

    if (typeof parsed.data?.audio !== 'string') {
      throw new APICallError({
        message: 'MiniMax response did not include audio data',
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders: headersRecord,
        responseBody
      })
    }

    let audio: Uint8Array
    try {
      audio = decodeHexAudio(parsed.data.audio)
    } catch (cause) {
      throw new APICallError({
        message: 'Invalid hex audio response from MiniMax',
        cause,
        url,
        requestBodyValues: body,
        statusCode: response.status,
        responseHeaders: headersRecord,
        responseBody
      })
    }

    return {
      audio,
      warnings,
      request: {
        body: JSON.stringify(body)
      },
      response: {
        timestamp: currentDate,
        modelId: this.modelId,
        headers: headersRecord,
        body: parsed
      }
    }
  }
}
