import { openAsBlob } from 'node:fs'

import { net } from 'electron'

import { loggerService } from '@logger'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileInfo } from '@shared/types/file'

import { getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler } from '../../types'

const logger = loggerService.withContext('FileProcessing:openaiTranscription')

const DEFAULT_MODEL = 'whisper-1'
const MAX_UPLOAD_BYTES = 25_000_000
const MAX_ATTEMPTS = 3
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

export const openaiTranscriptionAudioToTextHandler: FileProcessingCapabilityHandler<'audio_to_text'> = {
  mode: 'background',
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`Audio file exceeds ${MAX_UPLOAD_BYTES} bytes; chunk before transcription`)
    }
    const context = prepareContext(file, config)

    return {
      mode: 'background',
      async execute(executionContext) {
        executionContext.signal.throwIfAborted()
        const result = await transcribeDetailed(context, executionContext.signal)
        return { kind: 'text', text: result.text, ...(result.segments ? { segments: result.segments } : {}) }
      }
    }
  }
}

interface PreparedTranscriptionContext {
  file: FileInfo
  apiHost: string
  apiKey: string
  model: string
}

function prepareContext(file: FileInfo, config: FileProcessorMerged): PreparedTranscriptionContext {
  const capability = getRequiredCapability(config, 'audio_to_text', 'openai-transcription')
  return {
    file,
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'openai-transcription'),
    model: capability.modelId?.trim() || DEFAULT_MODEL
  }
}

function supportsVerboseSegments(model: string): boolean {
  return model.trim().toLowerCase() === 'whisper-1'
}

async function transcribeDetailed(
  context: PreparedTranscriptionContext,
  signal: AbortSignal
): Promise<{ text: string; segments?: { startMs: number; endMs: number; text: string }[] }> {
  const filename = context.file.ext ? `${context.file.name}.${context.file.ext}` : context.file.name
  const useVerbose = supportsVerboseSegments(context.model)

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    signal.throwIfAborted()
    logger.debug('Posting OpenAI-compatible transcription', {
      model: context.model,
      filename,
      attempt,
      responseFormat: useVerbose ? 'verbose_json' : 'json'
    })

    try {
      const payload = await postTranscription(context, filename, signal, useVerbose)
      const text = extractTranscriptionText(payload)
      if (text == null) throw new Error('OpenAI transcription returned no text')
      if (!useVerbose) return { text }
      const segments = extractTranscriptionSegments(payload, 0)
      return segments.length > 0 ? { text, segments } : { text }
    } catch (error) {
      if (signal.aborted) throw error
      const err = error instanceof Error ? error : new Error(String(error))
      const statusMatch = /OpenAI transcription failed: (\d{3})/.exec(err.message)
      const status = statusMatch ? Number(statusMatch[1]) : undefined
      const permanentHttp = status != null && !RETRYABLE_STATUS.has(status)
      const permanent = permanentHttp || err.message.includes('returned no text')
      if (permanent || attempt === MAX_ATTEMPTS) throw err
      lastError = err
      await delay(250 * attempt, signal)
    }
  }
  throw lastError ?? new Error('OpenAI transcription failed')
}

async function postTranscription(
  context: PreparedTranscriptionContext,
  filename: string,
  signal: AbortSignal,
  verboseSegments: boolean
): Promise<unknown> {
  const endpoint = sanitizeRemoteUrl(`${context.apiHost}/v1/audio/transcriptions`, context.apiHost)
  const fileBlob = await openAsBlob(context.file.path)
  if (fileBlob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Audio file exceeds ${MAX_UPLOAD_BYTES} bytes; chunk before transcription`)
  }
  const formData = new FormData()
  formData.append('file', fileBlob, filename)
  formData.append('model', context.model)
  if (verboseSegments) {
    formData.append('response_format', 'verbose_json')
    formData.append('timestamp_granularities[]', 'segment')
  } else {
    formData.append('response_format', 'json')
  }

  const response = await net.fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${context.apiKey}` },
    body: formData,
    signal,
    redirect: 'error'
  })

  if (!response.ok) {
    const message = await response.text()
    const error = new Error(`OpenAI transcription failed: ${response.status} ${response.statusText}`)
    if (!RETRYABLE_STATUS.has(response.status)) throw error
    logger.warn('Retryable OpenAI transcription HTTP failure', {
      status: response.status,
      detailLength: message.length
    })
    throw error
  }

  return response.json()
}

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('Aborted'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })

function extractTranscriptionText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  if ('text' in payload && typeof payload.text === 'string') return payload.text
  if ('segments' in payload && Array.isArray(payload.segments)) {
    const parts = payload.segments
      .map((segment) =>
        segment && typeof segment === 'object' && 'text' in segment && typeof segment.text === 'string'
          ? segment.text.trim()
          : ''
      )
      .filter(Boolean)
    if (parts.length > 0) return parts.join(' ')
  }
  return null
}

/** Exported for unit tests — parse OpenAI verbose_json segment offsets. */
export function extractTranscriptionSegments(
  payload: unknown,
  offsetMs = 0
): { startMs: number; endMs: number; text: string }[] {
  if (!payload || typeof payload !== 'object' || !('segments' in payload) || !Array.isArray(payload.segments)) {
    return []
  }
  const out: { startMs: number; endMs: number; text: string }[] = []
  for (const segment of payload.segments) {
    if (!segment || typeof segment !== 'object') continue
    const text = 'text' in segment && typeof segment.text === 'string' ? segment.text.trim() : ''
    if (!text) continue
    const start =
      'start' in segment && typeof segment.start === 'number' && Number.isFinite(segment.start)
        ? Math.round(segment.start * 1000)
        : 0
    const end =
      'end' in segment && typeof segment.end === 'number' && Number.isFinite(segment.end)
        ? Math.round(segment.end * 1000)
        : start
    out.push({ startMs: offsetMs + start, endMs: offsetMs + end, text })
  }
  return out
}
