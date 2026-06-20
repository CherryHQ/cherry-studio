import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileInfo } from '@shared/types/file'

export type ImageToTextHandlerOutput = {
  kind: 'text'
  text: string
}

export type DocumentToMarkdownHandlerOutput =
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

export type FileProcessingHandlerOutputByFeature = {
  image_to_text: ImageToTextHandlerOutput
  document_to_markdown: DocumentToMarkdownHandlerOutput
}

export type FileProcessingHandlerOutput<Feature extends FileProcessorFeature = FileProcessorFeature> =
  FileProcessingHandlerOutputByFeature[Feature]

export interface FileProcessingExecutionContext {
  signal: AbortSignal
  reportProgress(progress: number): void
}

export type FileProcessingRemoteContext = object

export interface FileProcessingPrepareContext {
  /**
   * Provider-specific task identifier (e.g. MinerU's `data_id`), supplied by the
   * caller. Optional at this generic boundary because most processors do not use
   * it; processors that require it assert during `prepare()` and throw when it is
   * missing (see `mineru/document-to-markdown/handler.ts`'s `if (!dataId)` guard).
   */
  dataId?: string
}

/**
 * Minimal cross-restart state persisted to jobTable.metadata for remote-poll
 * handlers. Whitelist semantics: only publishable identifiers go here — never
 * apiKey, signed URLs, tokens, or any other sensitive material. Sensitive
 * fields are re-read from FileProcessorMerged config on every execute() via
 * rehydrate().
 */
export interface PersistableRemoteState {
  providerTaskId: string
  /** Processor-specific phase tag (e.g. doc2x: 'parsing' | 'exporting'). */
  stage?: string
  /** Public endpoint URL. */
  apiHost?: string
}

export type FileProcessingRemotePollResult<
  Feature extends FileProcessorFeature = FileProcessorFeature,
  RemoteContext extends FileProcessingRemoteContext = FileProcessingRemoteContext
> =
  | {
      status: 'pending' | 'processing'
      progress: number
      /**
       * Return a new reference when the remote context has changed since the
       * last poll; the dispatcher uses identity comparison (`!==`) to detect
       * state mutation and persist it. Returning the same reference will be
       * treated as 'no change' and skip metadata persistence.
       */
      remoteContext?: RemoteContext
    }
  | {
      status: 'failed'
      error: string
    }
  | {
      status: 'completed'
      output: FileProcessingHandlerOutput<Feature>
    }

export interface PreparedBackgroundJob<Feature extends FileProcessorFeature = FileProcessorFeature> {
  mode: 'background'
  execute(executionContext: FileProcessingExecutionContext): Promise<FileProcessingHandlerOutput<Feature>>
}

export type FileProcessingRemoteJobRef<
  RemoteContext extends FileProcessingRemoteContext = FileProcessingRemoteContext
> = {
  providerTaskId: string
  remoteContext: RemoteContext
}

export interface PreparedRemoteJob<
  Feature extends FileProcessorFeature = FileProcessorFeature,
  RemoteContext extends FileProcessingRemoteContext = FileProcessingRemoteContext
> {
  mode: 'remote-poll'
  startRemote(signal?: AbortSignal): Promise<{
    providerTaskId: string
    status: 'pending' | 'processing'
    progress: number
    remoteContext: RemoteContext
  }>
  pollRemote(
    job: FileProcessingRemoteJobRef<RemoteContext>,
    signal?: AbortSignal
  ): Promise<FileProcessingRemotePollResult<Feature, RemoteContext>>
  /**
   * Project the in-memory remoteContext + providerTaskId down to the publishable
   * subset that gets written to jobTable.metadata. MUST NOT include apiKey or
   * any other sensitive material.
   */
  toPersistable(remoteContext: RemoteContext, providerTaskId: string): PersistableRemoteState
  /**
   * Restore in-memory remoteContext + providerTaskId after a cross-process
   * restart. Sensitive fields (apiKey, etc.) are re-read from `config`, not
   * recovered from `persisted`.
   */
  rehydrate(
    persisted: PersistableRemoteState,
    config: FileProcessorMerged
  ): { providerTaskId: string; remoteContext: RemoteContext }
}

export type PreparedFileProcessingJob<
  Feature extends FileProcessorFeature = FileProcessorFeature,
  RemoteContext extends FileProcessingRemoteContext = FileProcessingRemoteContext
> = PreparedBackgroundJob<Feature> | PreparedRemoteJob<Feature, RemoteContext>

export interface FileProcessingCapabilityHandler<
  Feature extends FileProcessorFeature = FileProcessorFeature,
  RemoteContext extends FileProcessingRemoteContext = FileProcessingRemoteContext
> {
  /**
   * Execution model declared statically on the handler. Mirrors the `mode`
   * field on PreparedJob but is available without awaiting prepare(), so the
   * orchestrator can route to the correct JobHandler synchronously at enqueue
   * time. Runtime assertion: prepared.mode must equal this value.
   */
  readonly mode: 'background' | 'remote-poll'
  prepare(
    file: FileInfo,
    config: FileProcessorMerged,
    signal?: AbortSignal,
    context?: FileProcessingPrepareContext
  ): Promise<PreparedFileProcessingJob<Feature, RemoteContext>> | PreparedFileProcessingJob<Feature, RemoteContext>
}

export type FileProcessingProcessorCapabilities = {
  [feature in FileProcessorFeature]?: FileProcessingCapabilityHandler<feature>
}

export type FileProcessingProcessorRegistry = {
  [processorId in FileProcessorId]: {
    capabilities: FileProcessingProcessorCapabilities
    isAvailable: () => boolean
  }
}
