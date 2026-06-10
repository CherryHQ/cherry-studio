import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileProcessingArtifact, FileProcessingJobOutput } from '@shared/data/types/fileProcessing'
import { FileProcessingJobOutputSchema } from '@shared/data/types/fileProcessing'
import type { FilePath } from '@shared/file/types'

import type { FileProcessingHandlerOutput } from '../processors/types'
import type { FileProcessingJobPayload } from '../tasks/shared'
import { markdownResultStore } from './MarkdownResultStore'

interface FileProcessingJobOutputContext {
  jobId: string
  signal: AbortSignal
  input: FileProcessingJobPayload
}

export async function createFileProcessingJobOutput(
  ctx: FileProcessingJobOutputContext,
  output: FileProcessingHandlerOutput
): Promise<FileProcessingJobOutput> {
  const artifact = await createFileProcessingArtifact(ctx.jobId, ctx.input, output, ctx.signal)
  return { artifact }
}

export function getFileProcessingMarkdownArtifactPath(snapshot: JobSnapshot): FilePath {
  const output = FileProcessingJobOutputSchema.parse(snapshot.output)
  if (!isMarkdownFileArtifact(output.artifact)) {
    throw new Error(`File processing job ${snapshot.id} completed without a markdown path artifact`)
  }
  return output.artifact.path as FilePath
}

export function isMarkdownFileArtifact(
  artifact: FileProcessingArtifact
): artifact is Extract<FileProcessingArtifact, { kind: 'file'; format: 'markdown' }> {
  return artifact.kind === 'file' && artifact.format === 'markdown'
}

export function getFileProcessingFailureMessage(snapshot: JobSnapshot): string {
  return snapshot.error?.message ?? 'no error details'
}

/**
 * Project a capability output into a persistable artifact. Text outputs become
 * inline artifacts; markdown / zip outputs are written to the caller-provided
 * path output target.
 */
async function createFileProcessingArtifact(
  jobId: string,
  input: FileProcessingJobPayload,
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
    case 'response-zip': {
      if (input.output?.kind !== 'path') {
        throw new Error(
          `File processing job ${jobId} produced a ${output.kind} result but no path output target was provided`
        )
      }

      return {
        kind: 'file',
        format: 'markdown',
        path: await markdownResultStore.persistResultToPath({
          jobId,
          result: output,
          path: input.output.path as FilePath,
          signal
        })
      }
    }
  }
}
