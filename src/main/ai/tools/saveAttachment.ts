import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { validatePath } from '@main/ai/mcp/servers/filesystem'
import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import { isAbortError } from '@main/utils/error'
import { getPathStatus } from '@main/utils/file'
import type { FilePath } from '@shared/types/file'
import * as z from 'zod'

import {
  assertWorkspacePathUnchanged,
  isErrno,
  publishFileNoClobber,
  relativeWorkspacePath
} from './assistantFileSafety'

const logger = loggerService.withContext('SaveAttachment')

export const SAVE_ATTACHMENT_TOOL_NAME = 'save_attachment'
export const SAVE_ATTACHMENT_DESCRIPTION =
  'Copy the original bytes of a file explicitly attached to this conversation into a new file in the current session workspace. ' +
  'Use the attachment handle shown in the conversation, pass a workspace-relative destination, and never overwrite an existing file. ' +
  'This action requires user approval.'

export const saveAttachmentInputSchema = z.object({
  filename: z.string().trim().min(1).max(512).describe('Attachment handle exactly as shown in the conversation.'),
  output_path: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((value) => !/^(?:[/\\]|[A-Za-z]:)/.test(value), 'Output path must be workspace-relative')
    .refine(
      (value) => !value.split(/[\\/]+/).some((segment) => segment === '..'),
      'Output path must not traverse outside the workspace'
    )
    .describe(
      'New workspace-relative file path. Its parent directory must exist and the destination must not already exist.'
    )
})

export type SaveAttachmentInput = z.infer<typeof saveAttachmentInputSchema>

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
  await assertWorkspacePathUnchanged(
    validatedInput.output_path,
    outputPath,
    resolvedWorkspacePath,
    'Attachment output path changed while being saved'
  )

  try {
    await application.get('FileManager').withTempCopy(attachment.fileEntryId, async (tempPath) => {
      signal.throwIfAborted()
      await publishFileNoClobber(tempPath as FilePath, outputPath, {
        signal,
        validateTarget: () =>
          assertWorkspacePathUnchanged(
            validatedInput.output_path,
            outputPath,
            resolvedWorkspacePath,
            'Attachment output path changed while being saved'
          )
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
