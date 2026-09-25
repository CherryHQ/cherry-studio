import { loggerService } from '@logger'
import type { ApiKeyEntry } from '@shared/data/types/provider'

const logger = loggerService.withContext('apiKeyImportExport')

export interface ExportFormat {
  version: 1
  timestamp: string
  keys: Array<{
    key: string
    label?: string
    tier?: string
    renewalAnchor?: string
    renewalTimezone?: string
    note?: string
  }>
}

/**
 * Parse CSV content and return array of partial ApiKeyEntry objects.
 * CSV header: key,label,tier,renewalAnchor,renewalTimezone,note
 * Only 'key' is required; others are optional.
 */
export function parseCSVContent(content: string): Partial<ApiKeyEntry>[] {
  const lines = content.trim().split('\n')
  if (lines.length < 2) {
    return []
  }

  const headerLine = lines[0]
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase())

  const keyIndex = headers.indexOf('key')
  const labelIndex = headers.indexOf('label')
  const tierIndex = headers.indexOf('tier')
  const renewalAnchorIndex = headers.indexOf('renewalanchor')
  const renewalTimezoneIndex = headers.indexOf('renewaltimezone')
  const noteIndex = headers.indexOf('note')

  if (keyIndex === -1) {
    logger.error('CSV header missing "key" column')
    return []
  }

  const result: Partial<ApiKeyEntry>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cells = parseCSVLine(line)
    const key = cells[keyIndex]?.trim()
    if (!key) {
      logger.warn(`Row ${i + 1}: skipping empty key`)
      continue
    }

    result.push({
      key,
      label: labelIndex >= 0 ? cells[labelIndex]?.trim() : undefined,
      tier: tierIndex >= 0 ? (cells[tierIndex]?.trim() as any) : undefined,
      renewalAnchor: renewalAnchorIndex >= 0 ? cells[renewalAnchorIndex]?.trim() : undefined,
      renewalTimezone: renewalTimezoneIndex >= 0 ? cells[renewalTimezoneIndex]?.trim() : undefined,
      note: noteIndex >= 0 ? cells[noteIndex]?.trim() : undefined
    })
  }

  return result
}

/**
 * Parse a single CSV line, handling quoted values.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"'
        i++ // Skip next quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  result.push(current)
  return result
}

/**
 * Parse ENV-style content (KEY=value lines).
 * Expected format: PROVIDER_0_KEY=..., PROVIDER_0_LABEL=..., etc.
 * Provider ID and key index are extracted from variable names.
 */
export function parseENVContent(content: string): Partial<ApiKeyEntry>[] {
  const lines = content.trim().split('\n')
  const keysByIndex: Map<string, Partial<ApiKeyEntry>> = new Map()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const varName = trimmed.substring(0, eqIndex).trim()
    const value = trimmed.substring(eqIndex + 1).trim()

    // Pattern: PROVIDER_INDEX_FIELD (e.g., OPENAI_0_KEY)
    const parts = varName.split('_')
    if (parts.length < 3) continue

    const keyIndex = parts[parts.length - 2]
    const field = parts[parts.length - 1].toLowerCase()

    if (!keysByIndex.has(keyIndex)) {
      keysByIndex.set(keyIndex, {})
    }

    const entry = keysByIndex.get(keyIndex)!
    if (field === 'key') entry.key = value
    else if (field === 'label') entry.label = value
    else if (field === 'tier') entry.tier = value as any
    else if (field === 'renewalanchor') entry.renewalAnchor = value
    else if (field === 'renewaltimezone') entry.renewalTimezone = value
    else if (field === 'note') entry.note = value
  }

  return Array.from(keysByIndex.values()).filter((e) => e.key)
}

/**
 * Generate CSV content from ApiKeyEntry array.
 */
export function generateCSVContent(keys: ApiKeyEntry[]): string {
  const header = 'key,label,tier,renewalAnchor,renewalTimezone,note'
  const rows = keys.map((k) => {
    const cells = [
      escapeCSVValue(k.key),
      escapeCSVValue(k.label || ''),
      escapeCSVValue(k.tier || ''),
      escapeCSVValue(k.renewalAnchor || ''),
      escapeCSVValue(k.renewalTimezone || ''),
      escapeCSVValue(k.note || '')
    ]
    return cells.join(',')
  })

  return [header, ...rows].join('\n')
}

function escapeCSVValue(value: string): string {
  if (!value) return ''
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Generate JSON export with metadata.
 */
export function generateJSONExport(keys: ApiKeyEntry[]): ExportFormat {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    keys: keys.map((k) => ({
      key: k.key,
      label: k.label,
      tier: k.tier,
      renewalAnchor: k.renewalAnchor,
      renewalTimezone: k.renewalTimezone,
      note: k.note
    }))
  }
}

/**
 * Parse JSON export format.
 */
export function parseJSONContent(content: string): Partial<ApiKeyEntry>[] {
  try {
    const data = JSON.parse(content) as ExportFormat
    if (data.version !== 1 || !Array.isArray(data.keys)) {
      logger.error('Invalid export format')
      return []
    }
    return data.keys as Partial<ApiKeyEntry>[]
  } catch (error) {
    logger.error('Failed to parse JSON export', { error })
    return []
  }
}

/**
 * Detect file format from filename or content.
 */
export function detectFormat(filename: string): 'csv' | 'env' | 'json' {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.env') || lower.endsWith('.env.local')) return 'env'
  if (lower.endsWith('.json')) return 'json'
  return 'csv' // default
}
