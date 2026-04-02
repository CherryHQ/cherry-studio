import type { FileMetadata } from '@renderer/types'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult,
  FileProcessingTextExtractionResult
} from '@shared/data/types/fileProcessing'

export interface PollMarkdownConversionTaskOptions {
  intervalMs?: number
  maxAttempts?: number
  onUpdate?: (result: FileProcessingMarkdownTaskResult) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function extractText(
  file: FileMetadata,
  processorId?: FileProcessorId
): Promise<FileProcessingTextExtractionResult> {
  return window.api.fileProcessing.extractText(file, processorId)
}

export async function startMarkdownConversionTask(
  file: FileMetadata,
  processorId?: FileProcessorId
): Promise<FileProcessingMarkdownTaskStartResult> {
  return window.api.fileProcessing.startMarkdownConversionTask(file, processorId)
}

export async function getMarkdownConversionTaskResult(
  providerTaskId: string,
  processorId: FileProcessorId
): Promise<FileProcessingMarkdownTaskResult> {
  return window.api.fileProcessing.getMarkdownConversionTaskResult(providerTaskId, processorId)
}

export async function pollMarkdownConversionTask(
  providerTaskId: string,
  processorId: FileProcessorId,
  options: PollMarkdownConversionTaskOptions = {}
): Promise<FileProcessingMarkdownTaskResult> {
  const { intervalMs = 1500, maxAttempts = 120, onUpdate } = options

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await getMarkdownConversionTaskResult(providerTaskId, processorId)
    onUpdate?.(result)

    if (result.status === 'completed' || result.status === 'failed') {
      return result
    }

    if (attempt < maxAttempts - 1) {
      await sleep(intervalMs)
    }
  }

  throw new Error(`File processing markdown conversion timed out for ${processorId}:${providerTaskId}`)
}
