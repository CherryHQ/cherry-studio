/**
 * TagsExporter
 * Exports tag data to JSONL format
 */

import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'

import { dbService } from '@data/db/DbService'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import type { BackupDomain } from '@shared/backup'
import { desc } from 'drizzle-orm'

import type { ExportContext, ExportResult } from './BaseDomainExporter'
import { BaseDomainExporter } from './BaseDomainExporter'

/**
 * Tag export data
 */
interface TagExportData {
  id: string
  name: string
  color: string | null
  createdAt: number
  updatedAt: number
}

/**
 * Entity-Tag association export data
 */
interface EntityTagExportData {
  entityType: string
  entityId: string
  tagId: string
  createdAt: number
  updatedAt: number
}

export class TagsExporter extends BaseDomainExporter {
  constructor() {
    super('tags' as BackupDomain)
  }

  async export(context: ExportContext): Promise<ExportResult> {
    this.validateContext(context)

    const totalCount = await this.countTags()
    context.progress.setDomain(this.domain, totalCount)

    const domainDir = await this.createDomainDir(context.baseDir)
    const tagsPath = path.join(domainDir, 'tags.jsonl')
    const entityTagsPath = path.join(domainDir, 'entity-tags.jsonl')

    const stats = await this.writeTags(tagsPath, entityTagsPath, context)

    // Compute combined checksum for the domain
    const checksum = await this.computeCombinedChecksum(tagsPath, entityTagsPath)

    // Combined file size
    const tagsStats = await fsPromises.stat(tagsPath)
    const entityTagsStats = await fsPromises.stat(entityTagsPath)

    return {
      domain: this.domain,
      itemCount: stats.itemCount,
      rawSize: stats.rawSize,
      compressedSize: tagsStats.size + entityTagsStats.size,
      checksum,
      dataPath: path.relative(context.baseDir, tagsPath)
    }
  }

  private async countTags(): Promise<number> {
    const db = dbService.getDb()
    const result = await db.select({ count: tagTable.id }).from(tagTable)
    return result.length
  }

  private async writeTags(
    tagsPath: string,
    entityTagsPath: string,
    context: ExportContext
  ): Promise<{ itemCount: number; rawSize: number }> {
    const db = dbService.getDb()
    let itemCount = 0
    let rawSize = 0

    // Write tags
    const tagsWriteStream = fs.createWriteStream(tagsPath)
    const { JsonlStringifier } = await import('../orchestrator/StreamSerializer')
    const tagsStringifier = new JsonlStringifier()
    tagsStringifier.pipe(tagsWriteStream)

    try {
      const tags = await db
        .select({
          id: tagTable.id,
          name: tagTable.name,
          color: tagTable.color,
          createdAt: tagTable.createdAt,
          updatedAt: tagTable.updatedAt
        })
        .from(tagTable)
        .orderBy(desc(tagTable.createdAt))

      for (const tag of tags) {
        const jsonBuffer = Buffer.from(JSON.stringify(tag))
        rawSize += jsonBuffer.length
        tagsStringifier.write(tag as TagExportData)
        itemCount++

        context.progress.incrementItemsProcessed()
        context.progress.updateBytesProcessed(jsonBuffer.length)
      }
    } finally {
      tagsStringifier.end()

      await new Promise<void>((resolve, reject) => {
        tagsWriteStream.on('finish', resolve)
        tagsWriteStream.on('error', reject)
      })
    }

    // Write entity-tag associations
    const entityTagsWriteStream = fs.createWriteStream(entityTagsPath)
    const entityTagsStringifier = new JsonlStringifier()
    entityTagsStringifier.pipe(entityTagsWriteStream)

    try {
      const entityTags = await db
        .select({
          entityType: entityTagTable.entityType,
          entityId: entityTagTable.entityId,
          tagId: entityTagTable.tagId,
          createdAt: entityTagTable.createdAt,
          updatedAt: entityTagTable.updatedAt
        })
        .from(entityTagTable)

      for (const entityTag of entityTags) {
        const jsonBuffer = Buffer.from(JSON.stringify(entityTag))
        rawSize += jsonBuffer.length
        entityTagsStringifier.write(entityTag as EntityTagExportData)

        context.progress.updateBytesProcessed(jsonBuffer.length)
      }
    } finally {
      entityTagsStringifier.end()

      await new Promise<void>((resolve, reject) => {
        entityTagsWriteStream.on('finish', resolve)
        entityTagsWriteStream.on('error', reject)
      })
    }

    return { itemCount, rawSize }
  }

  private async computeCombinedChecksum(filePath1: string, filePath2: string): Promise<string> {
    const { createHash } = await import('node:crypto')
    const content1 = await fsPromises.readFile(filePath1)
    const content2 = await fsPromises.readFile(filePath2)

    const hash = createHash('sha256')
    hash.update(content1)
    hash.update(content2)
    return hash.digest('hex')
  }
}
