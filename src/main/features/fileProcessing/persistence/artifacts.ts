import type { FileProcessingArtifact } from '@shared/data/types/fileProcessing'

import type { FileProcessingHandlerOutput } from '../processors/types'
import type { FileProcessingJobOutput, FileProcessingJobPayload } from '../tasks/shared'
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
          path: input.output.path,
          signal
        })
      }
    }
  }
}
