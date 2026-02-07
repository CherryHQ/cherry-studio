/**
 * Directory Reader for KnowledgeServiceV2
 *
 * Handles reading directories by scanning all files and reading each one.
 * Uses SimpleDirectoryReader from @vectorstores/readers/directory.
 */

import * as fs from 'node:fs'

import { loggerService } from '@logger'
import { windowService } from '@main/services/WindowService'
import type { DirectoryContainerData, DirectoryItemData } from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import type { Document } from '@vectorstores/core'
import { FILE_EXT_TO_READER, SimpleDirectoryReader } from '@vectorstores/readers/directory'
import { TextFileReader } from '@vectorstores/readers/text'

import { TextChunkSplitter } from '../splitters/TextChunkSplitter'
import {
  type ContentReader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type ReaderContext,
  type ReaderResult
} from '../types'
import { applyNodeMetadata } from './utils'

const logger = loggerService.withContext('DirectoryReader')

function isDirectoryItemData(data: DirectoryContainerData | DirectoryItemData): data is DirectoryItemData {
  return 'groupName' in data && typeof data.groupName === 'string'
}

function resolveDirectoryPath(data: DirectoryContainerData | DirectoryItemData): string {
  if (isDirectoryItemData(data)) {
    return data.groupName
  }

  return data.path
}

/**
 * Reader for directories using SimpleDirectoryReader
 */
export class DirectoryReader implements ContentReader {
  readonly type = 'directory' as const

  /**
   * Read all files in directory using SimpleDirectoryReader
   */
  async read(context: ReaderContext): Promise<ReaderResult> {
    const { base, item } = context
    const directoryData = item.data as DirectoryContainerData | DirectoryItemData
    const directoryPath = resolveDirectoryPath(directoryData)

    logger.debug(`Reading directory ${directoryPath} for item ${item.id}`)

    // Validate directory exists
    if (!fs.existsSync(directoryPath)) {
      logger.warn(`Directory not found: ${directoryPath}`)
      return { nodes: [] }
    }

    // Track progress for IPC updates
    let processedFiles = 0
    const totalFiles = this.countFiles(directoryPath)

    // Use SimpleDirectoryReader with configured readers
    const reader = new SimpleDirectoryReader((category, _name, status) => {
      if (category === 'file' && status === 1) {
        // ReaderStatus.COMPLETE = 1
        processedFiles++
        this.sendProgressUpdate(item.id, totalFiles, processedFiles)
      }
      return true // Continue processing
    })

    const documents = await reader.loadData({
      directoryPath,
      defaultReader: new TextFileReader(),
      fileExtToReader: FILE_EXT_TO_READER
    })

    if (documents.length === 0) {
      logger.warn(`No valid files found in directory: ${directoryPath}`)
      return { nodes: [] }
    }

    logger.debug(`Found ${documents.length} documents in directory ${directoryPath}`)

    // Normalize metadata and filter empty documents
    const filteredDocs = documents
      .map((doc) => {
        // Ensure source is set from file_path or existing source
        const source = doc.metadata?.file_path || doc.metadata?.source || 'unknown'
        doc.metadata = {
          ...doc.metadata,
          source,
          type: 'directory'
        }
        return doc as Document
      })
      .filter((doc) => doc.getText().trim().length > 0)

    // Split documents into chunks
    const chunkSize = base.chunkSize ?? DEFAULT_CHUNK_SIZE
    const chunkOverlap = base.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP
    const nodes = TextChunkSplitter(filteredDocs, { chunkSize, chunkOverlap })

    for (const node of nodes) {
      const source = node.metadata?.source || node.metadata?.file_path || 'unknown'
      applyNodeMetadata([node], { externalId: item.id, source, type: 'directory' })
    }

    logger.debug(`Directory ${directoryPath} read with ${nodes.length} total chunks from ${filteredDocs.length} files`)

    return { nodes }
  }

  /**
   * Count total files in directory recursively (for progress tracking)
   */
  private countFiles(dirPath: string): number {
    try {
      const entries = fs.readdirSync(dirPath, { recursive: true, withFileTypes: true })
      return entries.filter((e) => e.isFile() && !e.name.startsWith('.')).length
    } catch {
      return 0
    }
  }

  /**
   * Send progress update to renderer
   */
  private sendProgressUpdate(itemId: string, totalFiles: number, processedFiles: number): void {
    const mainWindow = windowService.getMainWindow()
    mainWindow?.webContents.send(IpcChannel.DirectoryProcessingPercent, {
      itemId,
      percent: totalFiles > 0 ? (processedFiles / totalFiles) * 100 : 0
    })
  }
}
