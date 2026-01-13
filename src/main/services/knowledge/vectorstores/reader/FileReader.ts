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
import { type FileReader as VectorstoreFileReader, SentenceSplitter } from '@vectorstores/core'
import { CSVReader } from '@vectorstores/readers/csv'
import { DocxReader } from '@vectorstores/readers/docx'
import { HTMLReader } from '@vectorstores/readers/html'
import { JSONReader } from '@vectorstores/readers/json'
import { MarkdownReader } from '@vectorstores/readers/markdown'
import { PDFReader } from '@vectorstores/readers/pdf'
import { TextFileReader } from '@vectorstores/readers/text'
import md5 from 'md5'

import {
  type ContentReader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type ReaderContext,
  type ReaderResult
} from '../types'
import { EpubReader } from './EpubReader'

const logger = loggerService.withContext('FileReader')

// File extension to reader type mapping
const FILE_READER_MAP: Record<string, string> = {
  // Use @vectorstores/readers
  '.pdf': 'vectorstores',
  '.csv': 'vectorstores',
  '.docx': 'vectorstores',
  '.json': 'vectorstores',
  '.md': 'vectorstores',
  '.epub': 'vectorstores',
  '.html': 'vectorstores',
  '.htm': 'vectorstores'
  // Other types default to 'text' (using TextFileReader)
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

    const readerType = FILE_READER_MAP[ext] || 'text'
    const chunkSize = base.chunkSize ?? DEFAULT_CHUNK_SIZE
    const chunkOverlap = base.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

    try {
      let documents: Document[]

      switch (readerType) {
        case 'vectorstores':
          documents = await this.readWithVectorstores(file)
          break

        default:
          // Use TextFileReader for all other file types
          documents = await this.readAsText(file)
          break
      }

      // Split documents into chunks if not already chunked
      const splitter = new SentenceSplitter({ chunkSize, chunkOverlap })
      const nodes = splitter.getNodesFromDocuments(documents)

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
   * Read file using @vectorstores/readers
   */
  private async readWithVectorstores(file: FileMetadata): Promise<Document[]> {
    const ext = file.ext.toLowerCase()

    const readerMap: Record<string, { name: string; create: () => VectorstoreFileReader }> = {
      '.csv': { name: 'CSVReader', create: () => new CSVReader() },
      '.docx': { name: 'DocxReader', create: () => new DocxReader() },
      '.html': { name: 'HTMLReader', create: () => new HTMLReader() },
      '.htm': { name: 'HTMLReader', create: () => new HTMLReader() },
      '.json': { name: 'JSONReader', create: () => new JSONReader() },
      '.md': { name: 'MarkdownReader', create: () => new MarkdownReader() },
      '.pdf': { name: 'PDFReader', create: () => new PDFReader() },
      '.epub': { name: 'EpubReader', create: () => new EpubReader() }
    }

    const readerInfo = readerMap[ext]
    if (!readerInfo) {
      throw new Error(`No reader found for extension: ${ext}`)
    }

    logger.info(`Reading file with ${readerInfo.name}: ${file.path}`)

    const reader = readerInfo.create()
    const documents = await reader.loadData(file.path)

    logger.info(`${readerInfo.name} read ${documents.length} documents from ${file.path}`)

    // Normalize metadata and filter empty documents
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

  /**
   * Read file as plain text using TextFileReader
   */
  private async readAsText(file: FileMetadata): Promise<Document[]> {
    logger.info(`Reading file with TextFileReader: ${file.path}`)

    const reader = new TextFileReader()
    const documents = await reader.loadData(file.path)

    logger.info(`TextFileReader read ${documents.length} documents from ${file.path}`)

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
