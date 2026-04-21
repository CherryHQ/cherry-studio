import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'

export type MarkdownProviderCompletionPayload =
  | {
      kind: 'markdown'
      markdownContent: string
    }
  | {
      kind: 'remote-zip-url'
      downloadUrl: string
      configuredApiHost: string
    }
  | {
      kind: 'response-zip'
      response: Response
    }

export interface MarkdownRemoteTaskStartResult {
  providerTaskId: string
  status: 'pending' | 'processing'
  progress: number
  queryContext: unknown
}

export interface MarkdownBackgroundTaskStartResult {
  providerTaskId: string
  status: 'pending' | 'processing'
  progress: number
}

export type MarkdownProviderPollResult =
  | {
      status: 'pending' | 'processing'
      progress: number
      queryContext?: unknown
    }
  | {
      status: 'failed'
      error: string
    }
  | {
      status: 'completed'
      result: MarkdownProviderCompletionPayload
    }

export interface MarkdownBackgroundExecutionContext {
  signal: AbortSignal
  reportProgress(progress: number): void
}

export interface MarkdownRemoteTaskProvider {
  mode: 'remote-poll'
  startTask(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<MarkdownRemoteTaskStartResult>
  pollTask(
    task: {
      providerTaskId: string
      queryContext: unknown
    },
    signal?: AbortSignal
  ): Promise<MarkdownProviderPollResult>
}

export interface MarkdownBackgroundTaskProvider {
  mode: 'background'
  startTask(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<MarkdownBackgroundTaskStartResult>
  executeTask(
    file: FileMetadata,
    config: FileProcessorMerged,
    context: MarkdownBackgroundExecutionContext
  ): Promise<MarkdownProviderCompletionPayload>
}

export type MarkdownProvider = MarkdownRemoteTaskProvider | MarkdownBackgroundTaskProvider

export interface MarkdownTaskRecord {
  taskId: string
  processorId: FileProcessorId
  providerTaskId: string
  fileId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  queryContext?: unknown
  markdownPath?: string
  error?: string
  createdAt: number
  updatedAt: number
}

export function toTaskStartResult(record: MarkdownTaskRecord): FileProcessingMarkdownTaskStartResult {
  return {
    taskId: record.taskId,
    status: record.status === 'pending' ? 'pending' : 'processing',
    progress: record.progress,
    processorId: record.processorId
  }
}

export function toTaskResult(record: MarkdownTaskRecord): FileProcessingMarkdownTaskResult {
  switch (record.status) {
    case 'pending':
      return {
        status: 'pending',
        progress: record.progress,
        processorId: record.processorId
      }
    case 'processing':
      return {
        status: 'processing',
        progress: record.progress,
        processorId: record.processorId
      }
    case 'failed':
      return {
        status: 'failed',
        progress: 0,
        processorId: record.processorId,
        error: record.error || 'Markdown conversion failed'
      }
    case 'completed':
      if (!record.markdownPath) {
        throw new Error(`Markdown task ${record.taskId} is completed without markdownPath`)
      }

      return {
        status: 'completed',
        progress: 100,
        processorId: record.processorId,
        markdownPath: record.markdownPath
      }
  }
}
