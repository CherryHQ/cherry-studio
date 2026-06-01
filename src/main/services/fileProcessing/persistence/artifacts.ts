import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileEntryId } from '@shared/data/types/file'
import type { FileProcessingArtifact, FileProcessingJobOutput } from '@shared/data/types/fileProcessing'
import { FileProcessingJobOutputSchema } from '@shared/data/types/fileProcessing'

import type { FileProcessingHandlerOutput } from '../processors/types'
import { markdownResultStore } from './MarkdownResultStore'

interface FileProcessingJobOutputContext {
  jobId: string
  signal: AbortSignal
}

export async function createFileProcessingJobOutput(
  ctx: FileProcessingJobOutputContext,
  output: FileProcessingHandlerOutput
): Promise<FileProcessingJobOutput> {
  const artifact = await createFileProcessingArtifact(ctx.jobId, output, ctx.signal)
  return { artifact }
}

export function getFileProcessingMarkdownArtifactFileEntryId(snapshot: JobSnapshot): FileEntryId {
  const output = FileProcessingJobOutputSchema.parse(snapshot.output)
  if (!isMarkdownFileArtifact(output.artifact)) {
    throw new Error(`File processing job ${snapshot.id} completed without a markdown file artifact`)
  }
  return output.artifact.fileEntryId
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
