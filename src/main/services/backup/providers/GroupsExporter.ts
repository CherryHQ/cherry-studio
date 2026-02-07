/**
 * GroupsExporter
 * Exports group data to JSONL format
 */

import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'

import { dbService } from '@data/db/DbService'
import { groupTable } from '@data/db/schemas/group'
import type { BackupDomain } from '@shared/backup'
import { desc } from 'drizzle-orm'

import type { ExportContext, ExportResult } from './BaseDomainExporter'
import { BaseDomainExporter } from './BaseDomainExporter'

/**
 * Group export data
 */
interface GroupExportData {
  id: string
  entityType: string
  name: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export class GroupsExporter extends BaseDomainExporter {
  constructor() {
    super('groups' as BackupDomain)
  }

  async export(context: ExportContext): Promise<ExportResult> {
    this.validateContext(context)

    const totalCount = await this.countGroups()
    context.progress.setDomain(this.domain, totalCount)

    const domainDir = await this.createDomainDir(context.baseDir)
    const outputPath = path.join(domainDir, 'groups.jsonl')

    const stats = await this.writeGroups(outputPath, context)

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

  private async countGroups(): Promise<number> {
    const db = dbService.getDb()
    const result = await db.select({ count: groupTable.id }).from(groupTable)
    return result.length
  }

  private async writeGroups(
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
      const groups = await db
        .select({
          id: groupTable.id,
          entityType: groupTable.entityType,
          name: groupTable.name,
          sortOrder: groupTable.sortOrder,
          createdAt: groupTable.createdAt,
          updatedAt: groupTable.updatedAt
        })
        .from(groupTable)
        .orderBy(desc(groupTable.createdAt))

      for (const group of groups) {
        const jsonBuffer = Buffer.from(JSON.stringify(group))
        rawSize += jsonBuffer.length
        stringifier.write(group as GroupExportData)
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
