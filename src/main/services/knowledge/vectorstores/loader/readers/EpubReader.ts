import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { getTempDir } from '@main/utils/file'
import { Document, FileReader } from '@vectorstores/core'
import EPub from 'epub'

const logger = loggerService.withContext('EpubReader')

interface EpubMetadata {
  creator?: string
  title?: string
  language?: string
  subject?: string
  date?: string
  description?: string
}

interface EpubChapter {
  id: string
}

/**
 * EPUB file reader based on @vectorstores/core FileReader interface
 */
export class EpubReader extends FileReader<Document> {
  /**
   * Load EPUB content from Uint8Array
   * Note: epub library requires file path, so we write to temp file first
   */
  async loadDataAsContent(fileContent: Uint8Array, filename?: string): Promise<Document[]> {
    // Write to temp file (epub library requires file path)
    const tempFilePath = path.join(getTempDir(), `epub-${Date.now()}-${filename || 'book.epub'}`)
    fs.writeFileSync(tempFilePath, Buffer.from(fileContent))

    try {
      const { text, metadata } = await this.parseEpub(tempFilePath)

      if (!text.trim()) {
        logger.warn(`Empty epub file: ${filename}`)
        return []
      }

      const doc = new Document({
        text,
        metadata: {
          source: filename || 'unknown',
          type: 'epub',
          title: metadata.title || '',
          creator: metadata.creator || '',
          language: metadata.language || ''
        }
      })

      logger.info(`EPUB loaded: ${metadata.title || filename} (${text.length} chars)`)

      return [doc]
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath)
      }
    }
  }

  private async parseEpub(filePath: string): Promise<{ text: string; metadata: EpubMetadata }> {
    const epub = new EPub(filePath)

    const { metadata, chapters } = await this.waitForEpubInit(epub)

    if (!chapters || chapters.length === 0) {
      throw new Error('No content found in epub file')
    }

    const textParts: string[] = []
    for (const chapter of chapters) {
      try {
        const content = await this.getChapter(epub, chapter.id)
        if (content) {
          // Remove HTML tags and clean text
          const text = content
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
          if (text) {
            textParts.push(text)
          }
        }
      } catch (error) {
        logger.error(`Error processing chapter ${chapter.id}:`, error as Error)
      }
    }

    return {
      text: textParts.join('\n\n'),
      metadata
    }
  }

  private waitForEpubInit(epub: EPub): Promise<{ metadata: EpubMetadata; chapters: EpubChapter[] }> {
    return new Promise((resolve, reject) => {
      epub.on('end', () => {
        resolve({
          metadata: {
            creator: epub.metadata.creator,
            title: epub.metadata.title,
            language: epub.metadata.language,
            subject: epub.metadata.subject,
            date: epub.metadata.date,
            description: epub.metadata.description
          },
          chapters: epub.flow.map((ch) => ({ id: ch.id }))
        })
      })
      epub.on('error', reject)
      epub.parse()
    })
  }

  private getChapter(epub: EPub, chapterId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      epub.getChapter(chapterId, (error, text) => {
        if (error) reject(error)
        else resolve(text)
      })
    })
  }
}
