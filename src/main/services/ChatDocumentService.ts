import { loggerService } from '@logger'
import PreprocessProviderService from '@main/knowledge/preprocess/PreprocessProvider'
import type { FileMetadata, PreprocessProvider } from '@types'

import { fileStorage } from './FileStorage'

const logger = loggerService.withContext('ChatDocumentService')

class ChatDocumentService {
  public async readStoredDocument(file: FileMetadata, preprocessProvider?: PreprocessProvider): Promise<string> {
    if (file.ext.toLowerCase() !== '.pdf' || !preprocessProvider) {
      return fileStorage.readFile(undefined as never, file.id + file.ext, true)
    }

    try {
      const provider = new PreprocessProviderService(preprocessProvider)
      const processedFile =
        (await provider.checkIfAlreadyProcessed(file)) ??
        (await provider.parseFile(`chat-${file.id}`, file)).processedFile

      return fileStorage.readExternalFile(undefined as never, processedFile.path, true)
    } catch (error) {
      logger.warn(
        `Failed to preprocess PDF ${file.origin_name} for chat: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        error instanceof Error ? error : undefined
      )
      throw error
    }
  }
}

export const chatDocumentService = new ChatDocumentService()
