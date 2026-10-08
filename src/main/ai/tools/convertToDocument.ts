import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { validatePath } from '@main/ai/mcp/servers/filesystem'
import { getPathStatus } from '@main/utils/file'
import { convertToDocumentInputSchema, type ConvertToDocumentInput } from '@shared/ai/documentConversionTool'
import { documentArtifactSchema, documentMimeTypes, type DocumentArtifact } from '@shared/types/documentConversion'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import {
  assertWorkspacePathUnchanged,
  hasWindowsInvalidFilenameSegment,
  isErrno,
  publishFileNoClobber,
  relativeWorkspacePath
} from './assistantFileSafety'

const logger = loggerService.withContext('ConvertToDocument')

export async function convertToDocumentToWorkspace(
  workspacePath: string,
  input: ConvertToDocumentInput,
  signal: AbortSignal
): Promise<DocumentArtifact> {
  signal.throwIfAborted()
  const { markdown, format, output_path } = convertToDocumentInputSchema.parse(input)
  const requestedPath = output_path ?? `generated-${randomUUID()}.${format}`
  if (hasWindowsInvalidFilenameSegment(requestedPath)) {
    throw new Error('Output path contains characters invalid in Windows filenames')
  }
  if (path.extname(requestedPath).toLowerCase() !== `.${format}`) {
    throw new Error(`Output path must end in .${format}`)
  }

  const resolvedWorkspacePath = await validatePath('.', workspacePath)
  const outputPath = AbsoluteFilePathSchema.parse(await validatePath(requestedPath, resolvedWorkspacePath))
  const parentStatus = await getPathStatus(path.dirname(outputPath))
  if (!parentStatus.ok || parentStatus.kind !== 'directory') {
    throw new Error('Document output parent must be an existing workspace directory')
  }
  const outputStatus = await getPathStatus(outputPath)
  if (outputStatus.ok || outputStatus.reason !== 'missing') {
    throw new Error(`Document output already exists or is inaccessible: ${requestedPath}`)
  }
  const { convertDocument } = await import('@main/services/documentConversion')
  const bytes = await convertDocument(
    {
      markdown,
      format,
      ...(output_path ? { title: path.basename(requestedPath, path.extname(requestedPath)) } : {}),
      assetRoot: resolvedWorkspacePath
    },
    signal
  )
  signal.throwIfAborted()
  const temporaryDirectory = await mkdtemp(application.getPath('app.temp', 'document-conversion-'))
  try {
    const temporaryPath = AbsoluteFilePathSchema.parse(path.join(temporaryDirectory, `document.${format}`))
    await writeFile(temporaryPath, bytes, { flag: 'wx', signal })
    await publishFileNoClobber(temporaryPath, outputPath, {
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
    if (isErrno(error, 'EEXIST')) throw new Error(`Document output already exists: ${requestedPath}`)
    throw error
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch((error: unknown) => {
      logger.warn('Failed to remove document conversion temporary files', { temporaryDirectory, error })
    })
  }
  return documentArtifactSchema.parse({
    path: relativeWorkspacePath(resolvedWorkspacePath, outputPath),
    format,
    mime: documentMimeTypes[format]
  })
}
