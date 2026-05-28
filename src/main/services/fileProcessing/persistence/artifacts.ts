import { loggerService } from '@logger'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { AbsolutePathSchema } from '@shared/data/types/file'
import type { FileProcessingArtifact, FileProcessingJobOutput } from '@shared/data/types/fileProcessing'
import { FileProcessingJobOutputSchema } from '@shared/data/types/fileProcessing'
import type { FilePath } from '@shared/file/types'
import * as z from 'zod'

import type { FileProcessingHandlerOutput } from '../processors/types'
import { cleanupFileProcessingResultsDir, markdownResultStore } from './MarkdownResultStore'

const logger = loggerService.withContext('FileProcessing:Artifacts')

const FilePathSchema = z.custom<FilePath>((value) => AbsolutePathSchema.safeParse(value).success, {
  message: 'path must be an absolute filesystem path'
})

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
    const artifacts = await createFileProcessingArtifacts(ctx.jobId, output, ctx.signal)
    return { artifacts }
  } catch (error) {
    if (output.kind !== 'text') {
      const cleaned = await cleanupFileProcessingResultsDir(ctx.jobId)
      logger.warn(logContext.failureMessage, {
        jobId: ctx.jobId,
        processorId: logContext.processorId,
        feature: logContext.feature,
        cleaned
      })
    }
    throw error
  }
}

export function getFileProcessingMarkdownArtifactPath(snapshot: JobSnapshot): FilePath {
  const output = FileProcessingJobOutputSchema.parse(snapshot.output)
  const artifact = output.artifacts.find((item) => item.kind === 'file' && item.format === 'markdown')
  if (!artifact) {
    throw new Error(`File processing job ${snapshot.id} completed without a markdown file artifact`)
  }
  return FilePathSchema.parse(artifact.path)
}

export function getFileProcessingFailureMessage(snapshot: JobSnapshot): string {
  return snapshot.error?.message ?? 'no error details'
}

/**
 * Project a capability output into persistable artifacts. Text outputs become
 * inline artifacts; markdown / zip outputs are written to disk by
 * MarkdownResultStore under a per-jobId directory.
 */
async function createFileProcessingArtifacts(
  jobId: string,
  output: FileProcessingHandlerOutput,
  signal: AbortSignal
): Promise<FileProcessingArtifact[]> {
  switch (output.kind) {
    case 'text':
      return [
        {
          kind: 'text',
          format: 'plain',
          text: output.text
        }
      ]

    case 'markdown':
    case 'remote-zip-url':
    case 'response-zip':
      return [
        {
          kind: 'file',
          format: 'markdown',
          path: await markdownResultStore.persistResult({
            jobId,
            result: output,
            signal
          })
        }
      ]
  }
}
