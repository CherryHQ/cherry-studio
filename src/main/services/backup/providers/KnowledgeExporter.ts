/**
 * KnowledgeExporter
 * Exports knowledge base data to JSONL format
 */

import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import type { BackupDomain } from '@shared/backup'

import type { ExportContext, ExportResult } from './BaseDomainExporter'
import { BaseDomainExporter } from './BaseDomainExporter'

const logger = loggerService.withContext('KnowledgeExporter')

/**
 * Knowledge base storage directory
 */
const KNOWLEDGE_STORAGE_DIR = 'KnowledgeBase'

/**
 * Knowledge base metadata (from metadata.json)
 */
interface KnowledgeBaseMetadata {
  id: string
  [key: string]: unknown
}

export class KnowledgeExporter extends BaseDomainExporter {
  constructor() {
    super('knowledge' as BackupDomain)
  }

  async export(context: ExportContext): Promise<ExportResult> {
    this.validateContext(context)

    const storageDir = path.join(getDataPath(), KNOWLEDGE_STORAGE_DIR)
    const knowledgeBases = await this.listKnowledgeBases(storageDir)

    context.progress.setDomain(this.domain, knowledgeBases.length)

    const domainDir = await this.createDomainDir(context.baseDir)
    const outputPath = path.join(domainDir, 'knowledge.jsonl')

    const stats = await this.writeKnowledgeBases(knowledgeBases, outputPath, context)

    const checksum = await this.computeFileHash(outputPath)
    const fileStats = await fsPromises.stat(outputPath)

    return {
      domain: this.domain,
      itemCount: stats.itemCount,
      rawSize: stats.rawSize,
      compressedSize: fileStats.size,
      checksum,
      dataPath: path.relative(context.baseDir, outputPath)
    }
  }

  /**
   * List all knowledge bases from storage directory
   */
  private async listKnowledgeBases(storageDir: string): Promise<KnowledgeBaseMetadata[]> {
    if (!fs.existsSync(storageDir)) {
      return []
    }

    const dirs = await fsPromises.readdir(storageDir)
    const bases: KnowledgeBaseMetadata[] = []

    for (const dir of dirs) {
      const dirPath = path.join(storageDir, dir)
      const stat = await fsPromises.stat(dirPath)

      if (stat.isDirectory()) {
        // Try to read metadata file
        const metadataPath = path.join(dirPath, 'metadata.json')
        if (fs.existsSync(metadataPath)) {
          try {
            const content = await fsPromises.readFile(metadataPath, 'utf-8')
            const metadata = JSON.parse(content) as KnowledgeBaseMetadata
            bases.push(metadata)
          } catch (error) {
            // Skip invalid metadata
            logger.warn('Failed to read knowledge base metadata', {
              dir,
              error: String(error)
            })
          }
        }
      }
    }

    return bases
  }

  /**
   * Export knowledge bases
   */
  private async writeKnowledgeBases(
    bases: KnowledgeBaseMetadata[],
    outputPath: string,
    context: ExportContext
  ): Promise<{ itemCount: number; rawSize: number }> {
    let itemCount = 0
    let rawSize = 0

    const writeStream = fs.createWriteStream(outputPath)
    const { JsonlStringifier } = await import('../orchestrator/StreamSerializer')
    const stringifier = new JsonlStringifier()
    stringifier.pipe(writeStream)

    try {
      for (const base of bases) {
        const jsonBuffer = Buffer.from(JSON.stringify(base))
        rawSize += jsonBuffer.length
        stringifier.write(base)
        itemCount++

        context.progress.incrementItemsProcessed()
        context.progress.updateBytesProcessed(jsonBuffer.length)
      }
    } finally {
      stringifier.end()

      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
      })
    }

    return { itemCount, rawSize }
  }
}
