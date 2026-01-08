/**
 * File Loader for KnowledgeServiceV2
 *
 * Handles loading various file types and converting them to vectorstores nodes.
 * Uses existing loaders from embedjs for non-markdown files.
 */

import * as fs from 'node:fs'

import { JsonLoader, LocalPathLoader, TextLoader } from '@cherrystudio/embedjs'
import { WebLoader } from '@cherrystudio/embedjs-loader-web'
import { loggerService } from '@logger'
import { readTextFileWithAutoEncoding } from '@main/utils/file'
import type { FileMetadata } from '@types'
import { Document, SentenceSplitter } from '@vectorstores/core'
import md5 from 'md5'

import {
  type ContentLoader,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  type LoaderContext,
  type LoaderResult
} from '../types'
import { loadMarkdownDocuments } from './markdownLoader'
import { EpubLoader } from './readers/epubLoader'
import { OdLoader, OdType } from './readers/odLoader'

const logger = loggerService.withContext('FileLoader')

// File extension to loader type mapping
const FILE_LOADER_MAP: Record<string, string> = {
  // Built-in types
  '.pdf': 'common',
  '.csv': 'common',
  '.doc': 'common',
  '.docx': 'common',
  '.pptx': 'common',
  '.xlsx': 'common',
  // Markdown (uses native vectorstores loader)
  '.md': 'markdown',
  // OD types
  '.odt': 'od',
  '.ods': 'od',
  '.odp': 'od',
  // EPUB type
  '.epub': 'epub',
  // HTML type
  '.html': 'html',
  '.htm': 'html',
  // JSON type
  '.json': 'json'
  // Other types default to text
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
        case 'markdown':
          documents = await loadMarkdownDocuments(file)
          break

        case 'common':
          documents = await this.loadWithEmbedjs(LocalPathLoader, {
            path: file.path,
            chunkSize,
            chunkOverlap
          })
          break

        case 'od':
          documents = await this.loadOdFile(file, chunkSize, chunkOverlap)
          break

        case 'epub':
          documents = await this.loadWithEmbedjs(EpubLoader, {
            filePath: file.path,
            chunkSize,
            chunkOverlap
          })
          break

        case 'html':
          const htmlContent = await readTextFileWithAutoEncoding(file.path)
          documents = await this.loadWithEmbedjs(WebLoader, {
            urlOrContent: htmlContent,
            chunkSize,
            chunkOverlap
          })
          break

        case 'json':
          documents = await this.loadJsonFile(file, chunkSize, chunkOverlap)
          break

        default:
          // Text type (default)
          const textContent = await readTextFileWithAutoEncoding(file.path)
          documents = await this.loadWithEmbedjs(TextLoader, {
            text: textContent,
            chunkSize,
            chunkOverlap
          })
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
   * Load file using embedjs loader and convert to vectorstores documents
   */
  private async loadWithEmbedjs(
    LoaderClass: new (
      options: any
    ) => { getUnfilteredChunks: () => AsyncGenerator<{ pageContent: string; metadata: any }> },
    options: any
  ): Promise<Document[]> {
    const loader = new LoaderClass(options)
    const documents: Document[] = []

    for await (const chunk of loader.getUnfilteredChunks()) {
      documents.push(
        new Document({
          text: chunk.pageContent,
          metadata: chunk.metadata || {}
        })
      )
    }

    return documents
  }

  /**
   * Load OD (OpenDocument) file
   */
  private async loadOdFile(file: FileMetadata, chunkSize: number, chunkOverlap: number): Promise<Document[]> {
    const loaderMap: Record<string, OdType> = {
      '.odt': OdType.OdtLoader,
      '.ods': OdType.OdsLoader,
      '.odp': OdType.OdpLoader
    }
    const odType = loaderMap[file.ext.toLowerCase()]
    if (!odType) {
      throw new Error(`Unknown OD type: ${file.ext}`)
    }

    return this.loadWithEmbedjs(OdLoader, {
      odType,
      filePath: file.path,
      chunkSize,
      chunkOverlap
    })
  }

  /**
   * Load JSON file
   */
  private async loadJsonFile(file: FileMetadata, chunkSize: number, chunkOverlap: number): Promise<Document[]> {
    try {
      const jsonContent = await readTextFileWithAutoEncoding(file.path)
      const jsonObject = JSON.parse(jsonContent)
      return this.loadWithEmbedjs(JsonLoader, { object: jsonObject })
    } catch (error) {
      // If JSON parsing fails, fall back to text loading
      logger.warn(`Failed to parse JSON file ${file.path}, falling back to text:`, error as Error)
      const textContent = await readTextFileWithAutoEncoding(file.path)
      return this.loadWithEmbedjs(TextLoader, {
        text: textContent,
        chunkSize,
        chunkOverlap
      })
    }
  }

  /**
   * Estimate workload based on file size
   */
  estimateWorkload(context: LoaderContext): number {
    const file = context.item.content as FileMetadata
    return file.size
  }
}
