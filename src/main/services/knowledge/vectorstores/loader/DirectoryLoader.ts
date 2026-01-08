/**
 * Directory Loader for KnowledgeServiceV2
 *
 * Handles loading directories by scanning all files and loading each one.
 * Uses FileLoader to process individual files.
 */

import { loggerService } from '@logger'
import { windowService } from '@main/services/WindowService'
import { getAllFiles } from '@main/utils/file'
import { IpcChannel } from '@shared/IpcChannel'
import type { FileMetadata } from '@types'
import type { BaseNode, Metadata } from '@vectorstores/core'
import { v4 as uuidv4 } from 'uuid'

import { type ContentLoader, type LoaderContext, type LoaderResult } from '../types'
import { FileLoader } from './FileLoader'

const logger = loggerService.withContext('DirectoryLoader')

/**
 * Loader for directories
 */
export class DirectoryLoader implements ContentLoader {
  readonly type = 'directory' as const
  private fileLoader: FileLoader

  constructor() {
    this.fileLoader = new FileLoader()
  }

  /**
   * Load all files in directory and aggregate results
   */
  async load(context: LoaderContext): Promise<LoaderResult> {
    const { item, itemId } = context
    const directoryPath = item.content as string

    const uniqueId = `DirectoryLoader_${uuidv4()}`

    logger.debug(`Loading directory ${directoryPath} for item ${itemId}`)

    // Get all files in directory
    const files = getAllFiles(directoryPath)

    if (files.length === 0) {
      logger.warn(`No valid files found in directory: ${directoryPath}`)
      return {
        nodes: [],
        uniqueId,
        loaderType: 'DirectoryLoader'
      }
    }

    logger.debug(`Found ${files.length} files in directory ${directoryPath}`)

    const allNodes: BaseNode<Metadata>[] = []
    const uniqueIds: string[] = []
    let processedFiles = 0

    // Process each file
    for (const file of files) {
      try {
        // Create a file item context
        const fileContext: LoaderContext = {
          ...context,
          item: {
            ...item,
            type: 'file',
            content: file
          }
        }

        const result = await this.fileLoader.load(fileContext)

        allNodes.push(...result.nodes)
        uniqueIds.push(result.uniqueId)
        processedFiles++

        // Send progress update to renderer
        this.sendProgressUpdate(itemId, files.length, processedFiles)
      } catch (error) {
        logger.error(`Failed to load file ${file.path} in directory:`, error as Error)
        // Continue with other files
      }
    }

    logger.debug(`Directory ${directoryPath} loaded with ${allNodes.length} total chunks from ${processedFiles} files`)

    return {
      nodes: allNodes,
      uniqueId,
      loaderType: 'DirectoryLoader'
    }
  }

  /**
   * Estimate workload based on total file sizes
   */
  estimateWorkload(context: LoaderContext): number {
    const directoryPath = context.item.content as string
    const files = getAllFiles(directoryPath)
    return files.reduce((total: number, file: FileMetadata) => total + file.size, 0)
  }

  /**
   * Send progress update to renderer
   */
  private sendProgressUpdate(itemId: string, totalFiles: number, processedFiles: number): void {
    const mainWindow = windowService.getMainWindow()
    mainWindow?.webContents.send(IpcChannel.DirectoryProcessingPercent, {
      itemId,
      percent: (processedFiles / totalFiles) * 100
    })
  }
}
