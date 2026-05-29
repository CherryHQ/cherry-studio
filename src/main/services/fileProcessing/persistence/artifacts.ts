import { loggerService } from '@logger'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileEntryId } from '@shared/data/types/file'
import type { FileProcessingArtifact, FileProcessingJobOutput } from '@shared/data/types/fileProcessing'
import { FileProcessingJobOutputSchema } from '@shared/data/types/fileProcessing'

import type { FileProcessingHandlerOutput } from '../processors/types'
import { markdownResultStore } from './MarkdownResultStore'

const logger = loggerService.withContext('FileProcessing:Artifacts')

interface FileProcessingJobOutputLogContext {
  feature: FileProcessorFeature
  processorId: FileProcessorId
  failureMessage: string
}

interface FileProcessingJobOutputContext {
  jobId: string
  signal: AbortSignal
}

export async function createFileProcessingJobOutput(
  ctx: FileProcessingJobOutputContext,
  output: FileProcessingHandlerOutput,
  logContext: FileProcessingJobOutputLogContext
): Promise<FileProcessingJobOutput> {
  try {
    const artifact = await createFileProcessingArtifact(ctx.jobId, output, ctx.signal)
    return { artifact }
  } catch (error) {
    logger.warn(logContext.failureMessage, error as Error, {
      jobId: ctx.jobId,
      processorId: logContext.processorId,
      feature: logContext.feature
    })
    throw error
  }
}

export function getFileProcessingMarkdownArtifactFileEntryId(snapshot: JobSnapshot): FileEntryId {
  const output = FileProcessingJobOutputSchema.parse(snapshot.output)
  if (output.artifact.kind !== 'file' || output.artifact.format !== 'markdown') {
    throw new Error(`File processing job ${snapshot.id} completed without a markdown file artifact`)
  }
  return output.artifact.fileEntryId
}

export function getFileProcessingFailureMessage(snapshot: JobSnapshot): string {
  return snapshot.error?.message ?? 'no error details'
}

/**
 * Project a capability output into a persistable artifact. Text outputs become
 * inline artifacts; markdown / zip outputs become internal FileManager entries.
 */
async function createFileProcessingArtifact(
  jobId: string,
  output: FileProcessingHandlerOutput,
  signal: AbortSignal
): Promise<FileProcessingArtifact> {
  switch (output.kind) {
    case 'text':
      return {
        kind: 'text',
        format: 'plain',
        text: output.text
      }

    case 'markdown':
    case 'remote-zip-url':
    case 'response-zip':
      return {
        kind: 'file',
        format: 'markdown',
        fileEntryId: await markdownResultStore.persistResult({
          jobId,
          result: output,
          signal
        })
      }
  }
}
