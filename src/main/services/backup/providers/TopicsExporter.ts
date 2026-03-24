/**
 * TopicsExporter
 * Exports topic/conversation data to JSONL format
 */

import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'

import { dbService } from '@data/db/DbService'
import { topicTable } from '@data/db/schemas/topic'
import type { BackupDomain } from '@shared/backup'
import { desc, isNull } from 'drizzle-orm'

import type { ExportContext, ExportResult } from './BaseDomainExporter'
import { BaseDomainExporter } from './BaseDomainExporter'

/**
 * Topic data structure for export
 */
interface TopicExportData {
  id: string
  name: string | null
  isNameManuallyEdited: boolean | null
  assistantId: string | null
  assistantMeta: unknown
  prompt: string | null
  activeNodeId: string | null
  groupId: string | null
  sortOrder: number
  isPinned: boolean | null
  pinnedOrder: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export class TopicsExporter extends BaseDomainExporter {
  constructor() {
    super('topics' as BackupDomain)
  }

  async export(context: ExportContext): Promise<ExportResult> {
    this.validateContext(context)

    const totalCount = await this.countTopics()
    context.progress.setDomain(this.domain, totalCount)

    const domainDir = await this.createDomainDir(context.baseDir)
    const outputPath = path.join(domainDir, 'topics.jsonl')

    const stats = await this.writeTopics(outputPath, context)

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

  private async countTopics(): Promise<number> {
    const db = dbService.getDb()
    const result = await db.select({ count: topicTable.id }).from(topicTable).where(isNull(topicTable.deletedAt))
    return result.length
  }

  private async writeTopics(
    outputPath: string,
    context: ExportContext
  ): Promise<{ itemCount: number; rawSize: number }> {
    const db = dbService.getDb()
    let itemCount = 0
    let rawSize = 0

    const writeStream = fs.createWriteStream(outputPath)
    const { JsonlStringifier } = await import('../orchestrator/StreamSerializer')
    const stringifier = new JsonlStringifier()
    stringifier.pipe(writeStream)

    try {
      const topics = await db
        .select({
          id: topicTable.id,
          name: topicTable.name,
          isNameManuallyEdited: topicTable.isNameManuallyEdited,
          assistantId: topicTable.assistantId,
          assistantMeta: topicTable.assistantMeta,
          prompt: topicTable.prompt,
          activeNodeId: topicTable.activeNodeId,
          groupId: topicTable.groupId,
          sortOrder: topicTable.sortOrder,
          isPinned: topicTable.isPinned,
          pinnedOrder: topicTable.pinnedOrder,
          createdAt: topicTable.createdAt,
          updatedAt: topicTable.updatedAt,
          deletedAt: topicTable.deletedAt
        })
        .from(topicTable)
        .where(isNull(topicTable.deletedAt))
        .orderBy(desc(topicTable.updatedAt))

      for (const topic of topics) {
        const jsonBuffer = Buffer.from(JSON.stringify(topic))
        rawSize += jsonBuffer.length
        stringifier.write(topic as TopicExportData)
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
