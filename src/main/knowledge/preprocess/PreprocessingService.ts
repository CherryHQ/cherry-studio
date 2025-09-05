import PreprocessProvider from '@main/knowledge/preprocess/PreprocessProvider'
import { loggerService } from '@main/services/LoggerService'
import { windowService } from '@main/services/WindowService'
import type { FileMetadata, KnowledgeBaseParams, KnowledgeItem } from '@types'

const logger = loggerService.withContext('PreprocessingService')

class PreprocessingService {
  public async preprocessFile(
    file: FileMetadata,
    base: KnowledgeBaseParams,
    item: KnowledgeItem,
    userId: string
  ): Promise<FileMetadata> {
    let fileToProcess: FileMetadata = file
    // Check if preprocessing is configured and applicable (e.g., for PDFs)
    if (base.preprocessProvider && file.ext.toLowerCase() === '.pdf') {
      try {
        const provider = new PreprocessProvider(base.preprocessProvider.provider, userId)

        // Check if file has already been preprocessed
        const alreadyProcessed = await provider.checkIfAlreadyProcessed(file)
        if (alreadyProcessed) {
          logger.debug(`File already preprocessed, using cached result: ${file.path}`)
          return alreadyProcessed
        }

        // Execute preprocessing
        logger.debug(`Starting preprocess for scanned PDF: ${file.path}`)
        const { processedFile, quota } = await provider.parseFile(item.id, file)
        fileToProcess = processedFile

        // Notify the UI
        const mainWindow = windowService.getMainWindow()
        mainWindow?.webContents.send('file-preprocess-finished', {
          itemId: item.id,
          quota: quota
        })
      } catch (err) {
        logger.error(`Preprocessing failed: ${err}`)
        // If preprocessing fails, re-throw the error to be handled by the caller
        throw new Error(`Preprocessing failed: ${err}`)
      }
    }

    return fileToProcess
  }

  public async checkQuota(base: KnowledgeBaseParams, userId: string): Promise<number> {
    try {
      if (base.preprocessProvider && base.preprocessProvider.type === 'preprocess') {
        const provider = new PreprocessProvider(base.preprocessProvider.provider, userId)
        return await provider.checkQuota()
      }
      throw new Error('No preprocess provider configured')
    } catch (err) {
      logger.error(`Failed to check quota: ${err}`)
      throw new Error(`Failed to check quota: ${err}`)
    }
  }
}

export const preprocessingService = new PreprocessingService()
