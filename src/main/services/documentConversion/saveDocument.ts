import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { dialog } from 'electron'

import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { exportErrorCodes } from '@shared/ipc/errors/export'
import { type DocumentArtifact, documentMimeTypes } from '@shared/types/documentConversion'
import { sanitizeFilename } from '@shared/utils/file'

import { convertDocument, type ConvertDocumentInput } from './convertDocument'
import { DocumentConversionError } from './DocumentConversionError'

const logger = loggerService.withContext('DocumentExport')

interface SaveDocumentInput extends Omit<ConvertDocumentInput, 'title'> {
  defaultName: string
}

export async function saveDocument({
  markdown,
  format,
  defaultName,
  sourcePath,
  assetRoot
}: SaveDocumentInput): Promise<DocumentArtifact | null> {
  const title = sanitizeFilename(defaultName.replace(/\.(?:md|markdown|pdf|docx|pptx|xlsx)$/i, '')) || 'Document'
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: t('dialog.save_file'),
    defaultPath: `${title}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  })
  if (canceled || !filePath) return null
  const staged = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  try {
    const buffer = await convertDocument({ markdown, format, title, sourcePath, assetRoot })
    await writeFile(staged, buffer, { flag: 'wx' })
    await rename(staged, filePath)
    return { path: filePath, format, mime: documentMimeTypes[format] }
  } catch (error) {
    if (error instanceof DocumentConversionError) throw error
    throw new DocumentConversionError(
      exportErrorCodes.DOCUMENT_SAVE_FAILED,
      error instanceof Error ? error.message : String(error),
      markdown.slice(0, 4000)
    )
  } finally {
    await rm(staged, { force: true }).catch((error) => logger.warn('Failed to remove staged export', { staged, error }))
  }
}
