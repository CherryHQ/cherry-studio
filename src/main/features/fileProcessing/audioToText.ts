/**
 * Inline audio transcription for Chat / AV hybrid preprocessing.
 *
 * Mirrors {@link ocrImageToText}: resolve processor → prepare → execute/poll
 * without JobManager. Does **not** cache transcripts — MediaPreprocessingService
 * owns the structured MediaAnalysis cache keyed by full execution config.
 */

import { loggerService } from '@logger'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileHandle } from '@shared/data/types/file'

import { resolveProcessorConfigByFeature } from './config/resolveProcessorConfig'
import { assertFileTypeSupported, getCapabilityHandler, resolveFileProcessingFileInfo } from './tasks/jobExecution'

const logger = loggerService.withContext('FileProcessing:audioToText')

const REMOTE_POLL_INTERVAL_MS = 2_000
const REMOTE_POLL_TIMEOUT_MS = 120_000

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('Aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export type AudioTranscriptionResult = {
  text: string
  segments?: { startMs: number; endMs: number; text: string }[]
}

export type AudioToTextOptions = {
  signal?: AbortSignal
  /** Prefer a frozen merged config from MediaExecutionConfig over re-resolving. */
  config?: FileProcessorMerged
  processorId?: FileProcessorId
}

export async function audioToText(
  file: FileHandle,
  signalOrOptions?: AbortSignal | AudioToTextOptions
): Promise<string> {
  const options = normalizeOptions(signalOrOptions)
  const result = await audioToTextDetailed(file, options)
  return result.text
}

/** Detailed transcription including optional provider segment timestamps. */
export async function audioToTextDetailed(
  file: FileHandle,
  signalOrOptions?: AbortSignal | AudioToTextOptions
): Promise<AudioTranscriptionResult> {
  const options = normalizeOptions(signalOrOptions)
  const feature = 'audio_to_text' as const
  const config = options.config ?? resolveProcessorConfigByFeature(feature, options.processorId)
  const handler = getCapabilityHandler(config.id, feature)
  const fileInfo = await resolveFileProcessingFileInfo(file)
  assertFileTypeSupported(fileInfo, feature, config)

  const prepared = await handler.prepare(fileInfo, config, options.signal)
  logger.debug('Running inline audio transcription', { processorId: config.id, mode: prepared.mode })

  if (prepared.mode === 'background') {
    const out = await prepared.execute({
      signal: options.signal ?? new AbortController().signal,
      reportProgress: () => {}
    })
    return { text: out.text, ...(out.segments ? { segments: out.segments } : {}) }
  }

  const started = await prepared.startRemote(options.signal)
  let ref = { providerTaskId: started.providerTaskId, remoteContext: started.remoteContext }
  const deadline = Date.now() + REMOTE_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await delay(REMOTE_POLL_INTERVAL_MS, options.signal)
    const res = await prepared.pollRemote(ref, options.signal)
    if (res.status === 'completed') {
      return {
        text: res.output.text,
        ...(res.output.segments ? { segments: res.output.segments } : {})
      }
    }
    if (res.status === 'failed') throw new Error(res.error)
    if (res.remoteContext) ref = { ...ref, remoteContext: res.remoteContext }
  }
  throw new Error('Audio transcription timed out')
}

function normalizeOptions(signalOrOptions?: AbortSignal | AudioToTextOptions): AudioToTextOptions {
  if (!signalOrOptions) return {}
  if (typeof signalOrOptions === 'object' && 'aborted' in signalOrOptions) {
    return { signal: signalOrOptions }
  }
  return signalOrOptions
}
