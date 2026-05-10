import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

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

export type FileProcessingRemotePollResult<
  Feature extends FileProcessorFeature = FileProcessorFeature,
  RemoteContext extends FileProcessingRemoteContext = FileProcessingRemoteContext
> =
  | {
      status: 'pending' | 'processing'
      progress: number
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

export interface PreparedBackgroundTask<Feature extends FileProcessorFeature = FileProcessorFeature> {
  mode: 'background'
  execute(executionContext: FileProcessingExecutionContext): Promise<FileProcessingHandlerOutput<Feature>>
}

export type FileProcessingRemoteTaskRef<
  RemoteContext extends FileProcessingRemoteContext = FileProcessingRemoteContext
> = {
  providerTaskId: string
  remoteContext: RemoteContext
}

export interface PreparedRemoteTask<
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
    task: FileProcessingRemoteTaskRef<RemoteContext>,
    signal?: AbortSignal
  ): Promise<FileProcessingRemotePollResult<Feature, RemoteContext>>
}

export type PreparedFileProcessingTask<
  Feature extends FileProcessorFeature = FileProcessorFeature,
  RemoteContext extends FileProcessingRemoteContext = FileProcessingRemoteContext
> = PreparedBackgroundTask<Feature> | PreparedRemoteTask<Feature, RemoteContext>

export interface FileProcessingCapabilityHandler<
  Feature extends FileProcessorFeature = FileProcessorFeature,
  RemoteContext extends FileProcessingRemoteContext = FileProcessingRemoteContext
> {
  prepare(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<PreparedFileProcessingTask<Feature, RemoteContext>> | PreparedFileProcessingTask<Feature, RemoteContext>
}

export type FileProcessingProcessorCapabilities = {
  [feature in FileProcessorFeature]?: FileProcessingCapabilityHandler<feature>
}

export type FileProcessingProcessorRegistry = {
  [processorId in FileProcessorId]: {
    capabilities: FileProcessingProcessorCapabilities
  }
}
