/**
 * File Loader for KnowledgeServiceV2
 *
 * Handles loading various file types and converting them to vectorstores nodes.
 * Uses @vectorstores/readers for structured file types.
 */

import * as fs from 'node:fs'

import { loggerService } from '@logger'
import type { FileMetadata } from '@types'
import type { Document } from '@vectorstores/core'
import { type FileReader, SentenceSplitter } from '@vectorstores/core'
import { CSVReader } from '@vectorstores/readers/csv'
import { DocxReader } from '@vectorstores/readers/docx'
import { HTMLReader } from '@vectorstores/readers/html'
import { JSONReader } from '@vectorstores/readers/json'
import { MarkdownReader } from '@vectorstores/readers/markdown'
import { PDFReader } from '@vectorstores/readers/pdf'
import { TextFileReader } from '@vectorstores/readers/text'
import md5 from 'md5'

import {
  type ContentLoader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type LoaderContext,
  type LoaderResult
} from '../types'
import { EpubReader } from './readers/EpubReader'

const logger = loggerService.withContext('FileLoader')

// File extension to loader type mapping
const FILE_LOADER_MAP: Record<string, string> = {
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
 * Loader for various file types
 */
export class FileLoader implements ContentLoader {
  readonly type = 'file' as const

  /**
   * Load file content and split into chunks
   */
  async load(context: LoaderContext): Promise<LoaderResult> {
    const { base, item, itemId } = context
    const file = item.content as FileMetadata
    const ext = file.ext.toLowerCase()

    const uniqueId = `FileLoader_${md5(file.path)}`

    logger.debug(`Loading file ${file.path} (ext: ${ext}) for item ${itemId}`)

    if (!fs.existsSync(file.path)) {
      logger.warn(`File not found: ${file.path}`)
      return {
        nodes: [],
        uniqueId,
        loaderType: 'FileLoader'
      }
    }

    const loaderType = FILE_LOADER_MAP[ext] || 'text'
    const chunkSize = base.chunkSize ?? DEFAULT_CHUNK_SIZE
    const chunkOverlap = base.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP

    try {
      let documents: Document[]

      switch (loaderType) {
        case 'vectorstores':
          documents = await this.loadWithVectorstores(file)
          break

        default:
          // Use TextFileReader for all other file types
          documents = await this.loadAsText(file)
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

      logger.debug(`File ${file.path} loaded with ${nodes.length} chunks`)

      return {
        nodes,
        uniqueId,
        loaderType: 'FileLoader'
      }
    } catch (error) {
      logger.error(`Failed to load file ${file.path}:`, error as Error)
      throw error
    }
  }

  /**
   * Load file using @vectorstores/readers
   */
  private async loadWithVectorstores(file: FileMetadata): Promise<Document[]> {
    const ext = file.ext.toLowerCase()

    const readerMap: Record<string, { name: string; create: () => FileReader }> = {
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

    logger.info(`Loading file with ${readerInfo.name}: ${file.path}`)

    const reader = readerInfo.create()
    const documents = await reader.loadData(file.path)

    logger.info(`${readerInfo.name} loaded ${documents.length} documents from ${file.path}`)

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
   * Load file as plain text using TextFileReader
   */
  private async loadAsText(file: FileMetadata): Promise<Document[]> {
    logger.info(`Loading file with TextFileReader: ${file.path}`)

    const reader = new TextFileReader()
    const documents = await reader.loadData(file.path)

    logger.info(`TextFileReader loaded ${documents.length} documents from ${file.path}`)

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
   * Estimate workload based on file size
   */
  estimateWorkload(context: LoaderContext): number {
    const file = context.item.content as FileMetadata
    return file.size
  }
}
