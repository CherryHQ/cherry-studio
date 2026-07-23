import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { validatePath } from '@main/ai/mcp/servers/filesystem'
import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import { isAbortError } from '@main/utils/error'
import { getPathStatus, publishFileNoClobber } from '@main/utils/file'
import { type SaveAttachmentInput, saveAttachmentInputSchema } from '@shared/ai/builtinTools'
import type { FilePath } from '@shared/types/file'

const logger = loggerService.withContext('SaveAttachment')

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code
}

function relativeWorkspacePath(workspacePath: string, outputPath: string): string {
  return path.relative(workspacePath, outputPath).split(path.sep).join('/')
}

function pathsEqual(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left)
  const resolvedRight = path.resolve(right)
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}

async function assertWorkspacePathUnchanged(
  requestedPath: string,
  expectedPath: string,
  workspacePath: string
): Promise<void> {
  const currentPath = await validatePath(requestedPath, workspacePath)
  if (!pathsEqual(currentPath, expectedPath)) {
    throw new Error(`Attachment output path changed while being saved: ${requestedPath}`)
  }
}

export async function saveAttachmentToWorkspace(
  workspacePath: string,
  input: SaveAttachmentInput,
  attachments: ReadonlyArray<FileAttachmentRef>,
  signal: AbortSignal
): Promise<{ path: string }> {
  signal.throwIfAborted()
  const validatedInput = saveAttachmentInputSchema.parse(input)
  const attachment = attachments.find(({ handle }) => handle === validatedInput.filename)
  if (!attachment) {
    const available = attachments.map(({ handle }) => handle).join(', ') || '(none)'
    throw new Error(`No attached file named "${validatedInput.filename}". Available: ${available}`)
  }

  const resolvedWorkspacePath = await validatePath('.', workspacePath)
  const outputPath = (await validatePath(validatedInput.output_path, resolvedWorkspacePath)) as FilePath
  signal.throwIfAborted()
  const outputDirectory = path.dirname(outputPath)
  const outputDirectoryStatus = await getPathStatus(outputDirectory)
  if (!outputDirectoryStatus.ok) {
    const reason = outputDirectoryStatus.reason === 'missing' ? 'does not exist' : 'is not accessible'
    throw new Error(`Attachment output directory ${reason}: ${path.dirname(validatedInput.output_path)}`)
  }
  if (outputDirectoryStatus.kind !== 'directory') {
    throw new Error(`Attachment output parent is not a directory: ${path.dirname(validatedInput.output_path)}`)
  }
  await assertWorkspacePathUnchanged(validatedInput.output_path, outputPath, resolvedWorkspacePath)

  try {
    await application.get('FileManager').withTempCopy(attachment.fileEntryId, async (tempPath) => {
      signal.throwIfAborted()
      await publishFileNoClobber(tempPath as FilePath, outputPath, {
        signal,
        validateTarget: () =>
          assertWorkspacePathUnchanged(validatedInput.output_path, outputPath, resolvedWorkspacePath)
      })
    })
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error
    if (isErrno(error, 'EEXIST')) {
      throw new Error(`Attachment output already exists: ${validatedInput.output_path}`)
    }
    logger.error('Failed to save attached file into the workspace', error as Error, {
      filename: validatedInput.filename,
      outputPath: validatedInput.output_path
    })
    throw new Error(`Failed to save attached file: ${validatedInput.output_path}`)
  }

  return { path: relativeWorkspacePath(resolvedWorkspacePath, outputPath) }
}
