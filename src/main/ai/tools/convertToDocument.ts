import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { validatePath } from '@main/ai/mcp/servers/filesystem'
import type { FileAttachment } from '@main/utils/downloadAsBase64'
import { getPathStatus } from '@main/utils/file'
import { convertToDocumentInputSchema, type ConvertToDocumentInput } from '@shared/ai/documentConversionTool'
import { documentArtifactSchema, documentMimeTypes, type DocumentArtifact } from '@shared/types/documentConversion'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import {
  assertWorkspacePathUnchanged,
  hasWindowsInvalidFilenameSegment,
  isErrno,
  relativeWorkspacePath
} from './assistantFileSafety'

export async function convertToDocumentToWorkspace(
  workspacePath: string,
  input: ConvertToDocumentInput,
  signal: AbortSignal,
  authorizedSource?: FileAttachment,
  sourceAssetRoot?: string
): Promise<DocumentArtifact> {
  signal.throwIfAborted()
  const { markdown, source_path, format, output_path } = convertToDocumentInputSchema.parse(input)
  const requestedPath = output_path ?? `generated-${randomUUID()}.${format}`
  if (hasWindowsInvalidFilenameSegment(requestedPath))
    throw new Error('Output path contains characters invalid in Windows filenames')
  if (path.extname(requestedPath).toLowerCase() !== `.${format}`) throw new Error(`Output path must end in .${format}`)
  const resolvedWorkspacePath = await validatePath('.', workspacePath)
  const outputPath = AbsoluteFilePathSchema.parse(await validatePath(requestedPath, resolvedWorkspacePath))
  const parentStatus = await getPathStatus(path.dirname(outputPath))
  if (!parentStatus.ok || parentStatus.kind !== 'directory')
    throw new Error('Document output parent must be an existing workspace directory')
  const outputStatus = await getPathStatus(outputPath)
  if (outputStatus.ok || outputStatus.reason !== 'missing')
    throw new Error(`Document output already exists or is inaccessible: ${requestedPath}`)
  const filePath = source_path
    ? authorizedSource
      ? path.resolve(workspacePath, source_path)
      : await validatePath(source_path, resolvedWorkspacePath)
    : undefined
  const { convertDocumentBundle, publishDocument } = await import('@main/services/documentConversion')
  const document = await convertDocumentBundle(
    {
      markdown,
      filePath,
      format,
      sourceName: authorizedSource?.filename,
      sourceBytes: authorizedSource ? Buffer.from(authorizedSource.data, 'base64') : undefined,
      outputName: path.basename(outputPath),
      title: path.basename(requestedPath, path.extname(requestedPath)),
      assetRoot: sourceAssetRoot ?? resolvedWorkspacePath
    },
    signal
  )
  signal.throwIfAborted()
  try {
    await publishDocument(document, outputPath, {
      signal,
      validateTarget: () =>
        assertWorkspacePathUnchanged(
          requestedPath,
          outputPath,
          resolvedWorkspacePath,
          'Document output path changed while being saved'
        )
    })
  } catch (error) {
    if (isErrno(error, 'EEXIST')) throw new Error(`Document output or resources already exist: ${requestedPath}`)
    throw error
  }
  return documentArtifactSchema.parse({
    path: relativeWorkspacePath(resolvedWorkspacePath, outputPath),
    format,
    mime: documentMimeTypes[format],
    warnings: document.warnings
  })
}
