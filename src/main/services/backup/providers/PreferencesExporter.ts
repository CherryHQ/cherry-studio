/**
 * PreferencesExporter
 * Exports user preferences to JSON format
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { dbService } from '@data/db/DbService'
import { preferenceTable } from '@data/db/schemas/preference'
import type { BackupDomain } from '@shared/backup'
import { ne } from 'drizzle-orm'

import type { ExportContext, ExportResult } from './BaseDomainExporter'
import { BaseDomainExporter } from './BaseDomainExporter'

/**
 * Sensitive key patterns to exclude from backup
 */
const SENSITIVE_PATTERNS = [
  /^secret/i,
  /^token/i,
  /^password/i,
  /^api[_-]/i,
  /^apiKey/i,
  /^userCredential/i,
  /credential/i,
  /auth/i
]

/**
 * Preference export data grouped by scope
 */
interface PreferenceGroupedData {
  [scope: string]: Record<string, unknown>
}

/**
 * Machine-specific keys to exclude
 */
const MACHINE_SPECIFIC_KEYS = new Set(['app.data_path', 'app.zoom_factor', 'app.window_state', 'app.frame_bounds'])

/**
 * Preference export data
 */
interface PreferenceExportData {
  scope: string
  key: string
  value: unknown
}

export class PreferencesExporter extends BaseDomainExporter {
  constructor() {
    super('preferences' as BackupDomain)
  }

  async export(context: ExportContext): Promise<ExportResult> {
    this.validateContext(context)

    const preferences = await this.fetchPreferences()
    const filteredPreferences = preferences.filter((pref) => !this.isSensitiveKey(pref.key))

    context.progress.setDomain(this.domain, filteredPreferences.length)

    const domainDir = await this.createDomainDir(context.baseDir)
    const outputPath = path.join(domainDir, 'preferences.json')

    await this.writePreferences(filteredPreferences, outputPath, context)

    const checksum = await this.computeFileHash(outputPath)
    const stats = await fs.stat(outputPath)

    return {
      domain: this.domain,
      itemCount: filteredPreferences.length,
      rawSize: stats.size,
      compressedSize: stats.size,
      checksum,
      dataPath: path.relative(context.baseDir, outputPath)
    }
  }

  private async fetchPreferences(): Promise<PreferenceExportData[]> {
    const db = dbService.getDb()
    return await db
      .select({
        scope: preferenceTable.scope,
        key: preferenceTable.key,
        value: preferenceTable.value,
        createdAt: preferenceTable.createdAt,
        updatedAt: preferenceTable.updatedAt
      })
      .from(preferenceTable)
      .where(ne(preferenceTable.value, null))
  }

  private isSensitiveKey(key: string): boolean {
    // Check machine-specific keys
    if (MACHINE_SPECIFIC_KEYS.has(key)) {
      return true
    }

    // Check sensitive patterns
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(key)) {
        return true
      }
    }

    return false
  }

  private async writePreferences(
    preferences: PreferenceExportData[],
    outputPath: string,
    context: ExportContext
  ): Promise<void> {
    // Group preferences by scope
    const grouped = preferences.reduce((acc, pref) => {
      if (!acc[pref.scope]) {
        acc[pref.scope] = {}
      }
      acc[pref.scope][pref.key] = pref.value
      return acc
    }, {} as PreferenceGroupedData)

    await fs.writeFile(outputPath, JSON.stringify(grouped, null, 2))

    for (const _pref of preferences) {
      context.progress.incrementItemsProcessed()
    }
  }
}
