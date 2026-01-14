/**
 * File Reader for KnowledgeServiceV2
 *
 * Handles reading various file types and converting them to vectorstores nodes.
 * Uses @vectorstores/readers for structured file types.
 */

import * as fs from 'node:fs'

import { loggerService } from '@logger'
import type { FileMetadata } from '@shared/data/types/file'
import type { FileItemData } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'
import { type FileReader as VectorstoreFileReader, MarkdownNodeParser } from '@vectorstores/core'
import { CSVReader } from '@vectorstores/readers/csv'
import { DocxReader } from '@vectorstores/readers/docx'
import { HTMLReader } from '@vectorstores/readers/html'
import { JSONReader } from '@vectorstores/readers/json'
import { MarkdownReader } from '@vectorstores/readers/markdown'
import { PDFReader } from '@vectorstores/readers/pdf'
import { TextFileReader } from '@vectorstores/readers/text'
import md5 from 'md5'

import { TextChunkSplitter } from '../spliters/TextChunkSplitter'
import {
  type ContentReader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type ReaderContext,
  type ReaderResult
} from '../types'
import { EpubReader } from './EpubReader'

const logger = loggerService.withContext('FileReader')

// Splitter type for document chunking
type SplitterType = 'text' | 'markdown'

// Configuration for each file type
interface FileTypeConfig {
  reader: () => VectorstoreFileReader
  splitter: SplitterType
}

// File extension to reader and splitter configuration
const FILE_CONFIG_MAP: Record<string, FileTypeConfig> = {
  '.pdf': { reader: () => new PDFReader(), splitter: 'text' },
  '.csv': { reader: () => new CSVReader(), splitter: 'text' },
  '.docx': { reader: () => new DocxReader(), splitter: 'text' },
  '.html': { reader: () => new HTMLReader(), splitter: 'text' },
  '.htm': { reader: () => new HTMLReader(), splitter: 'text' },
  '.json': { reader: () => new JSONReader(), splitter: 'text' },
  '.md': { reader: () => new MarkdownReader(), splitter: 'markdown' },
  '.epub': { reader: () => new EpubReader(), splitter: 'text' }
}

// Default config for unmapped extensions
const DEFAULT_CONFIG: FileTypeConfig = {
  reader: () => new TextFileReader(),
  splitter: 'text'
}

/**
 * Reader for various file types
 */
export class FileReader implements ContentReader {
  readonly type = 'file' as const

  /**
   * Read file content and split into chunks
   */
  async read(context: ReaderContext): Promise<ReaderResult> {
    const { base, item, itemId } = context
    const fileData = item.data as FileItemData
    const file = fileData.file
    const ext = file.ext.toLowerCase()

    const uniqueId = `FileReader_${md5(file.path)}`

    logger.debug(`Reading file ${file.path} (ext: ${ext}) for item ${itemId}`)

    if (!fs.existsSync(file.path)) {
      logger.warn(`File not found: ${file.path}`)
      return {
        nodes: [],
        uniqueId,
        readerType: 'FileReader'
      }
    }

    const config = FILE_CONFIG_MAP[ext] || DEFAULT_CONFIG
    const chunkSize = base.chunkSize ?? DEFAULT_CHUNK_SIZE
    const chunkOverlap = base.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

    try {
      const documents = await this.readDocuments(file, config)

      // Split documents into chunks using configured splitter
      const nodes =
        config.splitter === 'markdown'
          ? new MarkdownNodeParser().getNodesFromDocuments(documents)
          : TextChunkSplitter(documents, { chunkSize, chunkOverlap })

      // Add external_id and source to all nodes
      nodes.forEach((node) => {
        node.metadata = {
          ...node.metadata,
          external_id: itemId,
          source: file.path,
          type: 'file'
        }
      })

      logger.debug(`File ${file.path} read with ${nodes.length} chunks`)

      return {
        nodes,
        uniqueId,
        readerType: 'FileReader'
      }
    } catch (error) {
      logger.error(`Failed to read file ${file.path}:`, error as Error)
      throw error
    }
  }

  /**
   * Read documents using configured reader
   */
  private async readDocuments(file: FileMetadata, config: FileTypeConfig): Promise<Document[]> {
    const reader = config.reader()
    const readerName = reader.constructor.name

    logger.info(`Reading file with ${readerName}: ${file.path}`)

    const documents = await reader.loadData(file.path)

    logger.info(`${readerName} read ${documents.length} documents from ${file.path}`)

    return documents
      .map((doc) => {
        doc.metadata = {
          ...doc.metadata,
          source: file.path,
          type: 'file'
        }
        return doc as Document
      })
      .filter((doc) => doc.getText().trim().length > 0)
  }
}
