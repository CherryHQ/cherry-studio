/**
 * Inline OCR for the AI `read_file` tool — turns an image into text for models
 * that can't see it (non-vision) or providers that can't carry media in a tool
 * result.
 *
 * Reuses the file-processing resolution path (`resolveProcessorConfigByFeature`
 * → `getCapabilityHandler` → `prepare`) but invokes the handler **directly**
 * instead of going through `JobManager`: a chat tool call needs the text
 * synchronously, not a durable background job. Honors the user's configured
 * `image_to_text` processor (local Tesseract/System, or a remote OCR).
 */

import { loggerService } from '@logger'
import type { FileHandle } from '@shared/types/file'

import { resolveProcessorConfigByFeature } from './config/resolveProcessorConfig'
import { assertFileTypeSupported, getCapabilityHandler, resolveFileProcessingFileInfo } from './tasks/jobExecution'

const logger = loggerService.withContext('FileProcessing:ocrImageToText')

const REMOTE_POLL_INTERVAL_MS = 2_000
const REMOTE_POLL_TIMEOUT_MS = 120_000

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('Aborted'))
      },
      { once: true }
    )
  })

/**
 * OCR an image referenced by `file` into plain text using the configured
 * `image_to_text` processor. Throws on failure / no configured processor (the
 * caller turns that into a model-facing note).
 */
export async function ocrImageToText(file: FileHandle, signal?: AbortSignal): Promise<string> {
  const feature = 'image_to_text' as const
  const config = resolveProcessorConfigByFeature(feature)
  const handler = getCapabilityHandler(config.id, feature)
  const fileInfo = await resolveFileProcessingFileInfo(file)
  assertFileTypeSupported(fileInfo, feature, config)

  const prepared = await handler.prepare(fileInfo, config, signal)
  logger.debug('Running inline OCR', { processorId: config.id, mode: prepared.mode })

  if (prepared.mode === 'background') {
    const out = await prepared.execute({ signal: signal ?? new AbortController().signal, reportProgress: () => {} })
    return out.text
  }

  // Remote processor: start + poll inline until terminal (bounded).
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
