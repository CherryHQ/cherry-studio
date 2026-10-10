import path from 'node:path'

import { dialog } from 'electron'

import { t } from '@main/i18n'
import { exportErrorCodes } from '@shared/ipc/errors/export'
import { type DocumentArtifact, documentMimeTypes } from '@shared/types/documentConversion'
import { sanitizeFilename } from '@shared/utils/file'

import { convertDocumentBundle, type ConvertDocumentInput } from './convertDocument'
import { DocumentConversionError } from './DocumentConversionError'
import { publishDocument } from './publishDocument'

interface SaveDocumentInput extends Omit<ConvertDocumentInput, 'title'> {
  defaultName: string
}

export async function saveDocument(input: SaveDocumentInput): Promise<DocumentArtifact | null> {
  const { format, defaultName } = input
  const title =
    sanitizeFilename(defaultName.replace(/\.(?:md|markdown|pdf|docx|pptx|xlsx|html|htm)$/i, '')) || 'Document'
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: t('dialog.save_file'),
    defaultPath: input.filePath ? path.join(path.dirname(input.filePath), `${title}.${format}`) : `${title}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  })
  if (canceled || !filePath) return null
  try {
    const document = await convertDocumentBundle({ ...input, title, outputName: path.basename(filePath) })
    await publishDocument(document, filePath)
    return { path: filePath, format, mime: documentMimeTypes[format], warnings: document.warnings }
  } catch (error) {
    if (error instanceof DocumentConversionError) throw error
    throw new DocumentConversionError(
      error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'
        ? exportErrorCodes.TARGET_EXISTS
        : exportErrorCodes.DOCUMENT_SAVE_FAILED,
      error instanceof Error ? error.message : String(error),
      (input.markdown ?? input.filePath ?? '').slice(0, 4000)
    )
  }
}
