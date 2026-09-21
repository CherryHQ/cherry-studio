/**
 * Inline OCR for the AI `read_file` tool and AV frame preprocessing.
 *
 * Reuses file-processing resolution (`resolveProcessorConfigByFeature` →
 * `getCapabilityHandler` → `prepare`) but invokes the handler directly.
 * When a frozen {@link FileProcessorMerged} is supplied (hybrid media path),
 * that config is used as-is and results are not separately cached here —
 * MediaPreprocessingService owns the MediaAnalysis cache.
 */

import { application } from '@application'
import { loggerService } from '@logger'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileHandle } from '@shared/data/types/file'

import { resolveProcessorConfigByFeature } from './config/resolveProcessorConfig'
import { assertFileTypeSupported, getCapabilityHandler, resolveFileProcessingFileInfo } from './tasks/jobExecution'

const logger = loggerService.withContext('FileProcessing:ocrImageToText')

const REMOTE_POLL_INTERVAL_MS = 2_000
const REMOTE_POLL_TIMEOUT_MS = 120_000
const CACHE_TTL_MS = 30 * 60 * 1000

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

export type OcrImageToTextOptions = {
  signal?: AbortSignal
  processorId?: FileProcessorId
  /** Frozen config from MediaExecutionConfig — skips re-resolve and entry cache. */
  config?: FileProcessorMerged
}

export async function ocrImageToText(
  file: FileHandle,
  signalOrOptions?: AbortSignal | OcrImageToTextOptions,
  processorId?: FileProcessorId
): Promise<string> {
  const options = normalizeOptions(signalOrOptions, processorId)
  const feature = 'image_to_text' as const
  const config = options.config ?? resolveProcessorConfigByFeature(feature, options.processorId)

  // Only cache opportunistic entry OCR when the caller did not pin a frozen config.
  let cacheKey: string | null = null
  if (!options.config && file.kind === 'entry') {
    const cache = application.get('CacheService')
    const version = await application.get('FileManager').getVersion(file.entryId)
    cacheKey = `ocr-extraction:${file.entryId}:${version.mtime}:${version.size}:${config.id}`
    const cached = cache.get<string>(cacheKey)
    if (cached !== undefined) return cached
  }

  const text = await runOcr(file, config, options.signal)
  if (cacheKey) application.get('CacheService').set(cacheKey, text, CACHE_TTL_MS)
  return text
}

async function runOcr(file: FileHandle, config: FileProcessorMerged, signal?: AbortSignal): Promise<string> {
  const feature = 'image_to_text' as const
  const handler = getCapabilityHandler(config.id, feature)
  const fileInfo = await resolveFileProcessingFileInfo(file)
  assertFileTypeSupported(fileInfo, feature, config)

  const prepared = await handler.prepare(fileInfo, config, signal)
  logger.debug('Running inline OCR', { processorId: config.id, mode: prepared.mode })

  if (prepared.mode === 'background') {
    const out = await prepared.execute({ signal: signal ?? new AbortController().signal, reportProgress: () => {} })
    return out.text
  }

  const started = await prepared.startRemote(signal)
  let ref = { providerTaskId: started.providerTaskId, remoteContext: started.remoteContext }
  const deadline = Date.now() + REMOTE_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await delay(REMOTE_POLL_INTERVAL_MS, signal)
    const res = await prepared.pollRemote(ref, signal)
    if (res.status === 'completed') return res.output.text
    if (res.status === 'failed') throw new Error(res.error)
    if (res.remoteContext) ref = { ...ref, remoteContext: res.remoteContext }
  }
  throw new Error('OCR timed out')
}

function normalizeOptions(
  signalOrOptions?: AbortSignal | OcrImageToTextOptions,
  processorId?: FileProcessorId
): OcrImageToTextOptions {
  if (!signalOrOptions) return { processorId }
  if (typeof signalOrOptions === 'object' && 'aborted' in signalOrOptions) {
    return { signal: signalOrOptions, processorId }
  }
  return { ...signalOrOptions, processorId: signalOrOptions.processorId ?? processorId }
}
