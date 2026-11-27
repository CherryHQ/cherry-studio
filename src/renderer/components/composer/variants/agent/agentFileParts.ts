import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { buildFilePartsForAttachments, withComposerFilePartMeta } from '@renderer/utils/file/buildFileParts'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { FileUIPart } from '@shared/data/types/message'
import type { OutputFor } from '@shared/ipc/types'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { type CanonicalFilePath, canonicalizeFilePath, createFilePathHandle, toFileUrl } from '@shared/utils/file'

import { isPathWithinAccessiblePath } from './accessiblePath'

const logger = loggerService.withContext('AgentComposer')

const FILE_IPC_BATCH_SIZE = 500

type AccessibleAttachment = {
  attachment: ComposerAttachment
  filePath: CanonicalFilePath
  index: number
}

const requestAccessiblePathMetadata = async (
  attachments: readonly AccessibleAttachment[]
): Promise<OutputFor<'file.batch_get_metadata'>> => {
  if (attachments.length === 0) return {}

  const chunks: AccessibleAttachment[][] = []
  for (let i = 0; i < attachments.length; i += FILE_IPC_BATCH_SIZE) {
    chunks.push(attachments.slice(i, i + FILE_IPC_BATCH_SIZE))
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      ipcApi.request('file.batch_get_metadata', {
        items: chunk.map(({ filePath }) => ({
          key: filePath,
          handle: createFilePathHandle(filePath)
        }))
      })
    )
  )

  return Object.assign({}, ...results)
}

const buildAccessiblePathFilePart = (
  attachment: ComposerAttachment,
  filePath: CanonicalFilePath,
  metadataByPath: OutputFor<'file.batch_get_metadata'>
): FileUIPart => {
  const metadata = metadataByPath[filePath]
  if (!metadata || metadata.kind !== 'file') {
    throw new Error(`Agent workspace reference is not a file: ${attachment.path}`)
  }

  return withComposerFilePartMeta(
    {
      type: 'file',
      url: toFileUrl(filePath),
      mediaType: metadata.mime,
      filename: attachment.origin_name || attachment.name
    },
    attachment
  )
}

/**
 * `AgentWorkspacePathSchema` only guarantees a non-empty string, so the stored
 * workspace path is asserted to be an absolute filesystem path here, before it
 * reaches the path helpers. A malformed one yields no accessible paths, which
 * degrades to inlining attachments instead of referencing them — still correct,
 * just less efficient.
 */
export const toAccessiblePaths = (workspacePath: string | undefined): AbsoluteFilePath[] => {
  if (!workspacePath) return []
  const parsed = AbsoluteFilePathSchema.safeParse(workspacePath)
  if (!parsed.success) {
    logger.warn('Ignoring agent workspace path that is not an absolute filesystem path', { path: workspacePath })
    return []
  }
  return [parsed.data]
}

export const buildAgentFilePartsForAttachments = async (
  attachments: ComposerAttachment[],
  accessiblePaths: readonly AbsoluteFilePath[]
): Promise<FileUIPart[]> => {
  const accessibleAttachments: AccessibleAttachment[] = []
  const internalizedAttachments: ComposerAttachment[] = []
  const internalizedIndexes: number[] = []

  attachments.forEach((attachment, index) => {
    // A path-less attachment (message-editing round-trip) cannot be matched
    // against the workspace, so it takes the internalized branch — the same
    // outcome it already had when its non-path value failed the match.
    if (attachment.path && isPathWithinAccessiblePath(attachment.path, accessiblePaths)) {
      accessibleAttachments.push({
        attachment,
        filePath: canonicalizeFilePath(attachment.path),
        index
      })
      return
    }

    internalizedAttachments.push(attachment)
    internalizedIndexes.push(index)
  })

  const [metadataByPath, internalizedFileParts] = await Promise.all([
    requestAccessiblePathMetadata(accessibleAttachments),
    buildFilePartsForAttachments(internalizedAttachments)
  ])

  const fileParts = new Array<FileUIPart>(attachments.length)

  accessibleAttachments.forEach(({ attachment, filePath, index }) => {
    fileParts[index] = buildAccessiblePathFilePart(attachment, filePath, metadataByPath)
  })

  internalizedFileParts.forEach((filePart, offset) => {
    const originalIndex = internalizedIndexes[offset]
    if (originalIndex === undefined || !filePart) {
      throw new Error(`Failed to build file part for attachment: ${internalizedAttachments[offset]?.path ?? ''}`)
    }
    fileParts[originalIndex] = filePart
  })

  return fileParts
}
