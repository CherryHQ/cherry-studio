import { loggerService } from '@logger'
import { Mistral } from '@mistralai/mistralai'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'

import {
  assertHasFilePath,
  getRequiredApiHost,
  getRequiredApiKey,
  getRequiredCapability
} from '../../../utils/provider'
import type { FileProcessingCapabilityHandler } from '../../types'
import type { MistralDocumentUrlDocument, PreparedMistralContext } from '../types'
import {
  buildMarkdownConversionResult,
  deleteUploadedDocument,
  executeExtraction,
  getUploadedDocumentSignedUrl,
  uploadDocument
} from '../utils'

const logger = loggerService.withContext('MistralDocumentToMarkdownHandler')

export const mistralDocumentToMarkdownHandler: FileProcessingCapabilityHandler<'document_to_markdown'> = {
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    const context = prepareContext(file, config, signal)

    return {
      mode: 'background',
      async execute(executionContext) {
        const executionContextWithSignal = {
          ...context,
          signal: executionContext.signal
        }
        let uploadedFileId: string | undefined

        try {
          executionContext.reportProgress(10)
          uploadedFileId = await uploadDocument(executionContextWithSignal)
          executionContext.reportProgress(35)

          const documentUrl = await getUploadedDocumentSignedUrl(executionContextWithSignal, uploadedFileId)
          const document: MistralDocumentUrlDocument = {
            type: 'document_url',
            documentUrl
          }
          executionContext.reportProgress(45)

          const response = await executeExtraction(executionContextWithSignal, document, {
            tableFormat: 'html'
          })
          executionContext.reportProgress(85)

          return buildMarkdownConversionResult(response)
        } finally {
          if (uploadedFileId) {
            try {
              await deleteUploadedDocument(
                {
                  ...executionContextWithSignal,
                  signal: undefined
                },
                uploadedFileId
              )
              executionContext.reportProgress(95)
            } catch (error) {
              logger.warn('Failed to delete uploaded Mistral OCR file', {
                fileId: uploadedFileId,
                error: error instanceof Error ? error.message : String(error)
              })
            }
          }
        }
      }
    }
  }
}

function prepareContext(file: FileMetadata, config: FileProcessorMerged, signal?: AbortSignal): PreparedMistralContext {
  signal?.throwIfAborted()

  const capability = getRequiredCapability(config, 'document_to_markdown', 'mistral')
  assertHasFilePath(file)

  return {
    file,
    client: new Mistral({
      apiKey: getRequiredApiKey(config, 'mistral'),
      serverURL: getRequiredApiHost(capability)
    }),
    model: capability.modelId
  }
}
