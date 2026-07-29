import type { JournalDegradation } from '@data/db/restore/restoreJournalV2'
import { RelativeSubpathSchema } from '@main/utils/relativePath'
import { BACKUP_DEGRADATION_CODES, type BackupDegradationCode } from '@shared/ipc/schemas/backup'

const RESOURCE_DIAGNOSTIC_SAMPLE_LIMIT = 3
const JOURNAL_REPORT_KIND_PREFIX = 'report:'
const JOURNAL_REPORT_SAMPLE_KIND_PREFIX = 'report-sample:'
const JOURNAL_REPORT_COUNT_PREFIX = 'count:'

interface DegradationInput {
  readonly kind: string
  readonly reason: string
  readonly livePath?: string
}

export interface PresentedDegradation {
  readonly code: BackupDegradationCode
  readonly count: number
  readonly paths?: string[]
}

function parseDegradationCode(value: string): BackupDegradationCode | undefined {
  return BACKUP_DEGRADATION_CODES.find((code) => code === value)
}

function resourceDegradationCode(reason: string): BackupDegradationCode {
  if (reason === 'changed-after-snapshot') return 'resource-changed'
  if (reason === 'non-regular-source' || reason === 'unportable-source') return 'resource-nonportable'
  if (reason === 'resource-ceiling-exceeded') return 'resource-limit'
  return 'resource-unavailable'
}

function parseJournalReportCount(reason: string): number | undefined {
  if (!reason.startsWith(JOURNAL_REPORT_COUNT_PREFIX)) return undefined
  const count = Number(reason.slice(JOURNAL_REPORT_COUNT_PREFIX.length))
  return Number.isSafeInteger(count) && count > 0 ? count : undefined
}

function classifyDegradation(
  degradation: DegradationInput,
  parseJournalReport: boolean
): { code: BackupDegradationCode; count: number } {
  if (parseJournalReport && degradation.kind.startsWith(JOURNAL_REPORT_KIND_PREFIX)) {
    const code = parseDegradationCode(degradation.kind.slice(JOURNAL_REPORT_KIND_PREFIX.length)) ?? 'unknown'
    return { code, count: parseJournalReportCount(degradation.reason) ?? 1 }
  }
  if (parseJournalReport && degradation.kind.startsWith(JOURNAL_REPORT_SAMPLE_KIND_PREFIX)) {
    const code = parseDegradationCode(degradation.kind.slice(JOURNAL_REPORT_SAMPLE_KIND_PREFIX.length)) ?? 'unknown'
    return { code, count: 0 }
  }
  if (degradation.kind.startsWith('resource:')) {
    return { code: resourceDegradationCode(degradation.reason), count: 1 }
  }

  const parsed =
    /^(capability-malformed|external-file-dropped|path-unportable|path-collision|workspace-disconnected) \((\d+) rows?\)$/.exec(
      degradation.reason
    )
  if (!parsed) return { code: 'unknown', count: 1 }

  const parsedCount = Number(parsed[2])
  return {
    code: parsed[1] as BackupDegradationCode,
    count: Number.isSafeInteger(parsedCount) && parsedCount > 0 ? parsedCount : 1
  }
}

function safeSamplePath(degradation: DegradationInput): string | undefined {
  return degradation.livePath && RelativeSubpathSchema.safeParse(degradation.livePath).success
    ? degradation.livePath
    : undefined
}

function aggregateDegradations(
  degradations: readonly DegradationInput[],
  parseJournalReport: boolean
): PresentedDegradation[] {
  const presented = new Map<BackupDegradationCode, { count: number; paths: string[] }>()
  for (const degradation of degradations) {
    const classified = classifyDegradation(degradation, parseJournalReport)
    const entry = presented.get(classified.code) ?? { count: 0, paths: [] }
    const nextCount = entry.count + classified.count
    entry.count = Number.isSafeInteger(nextCount) ? nextCount : Number.MAX_SAFE_INTEGER
    const mayPresentPath =
      degradation.kind.startsWith('resource:') ||
      (parseJournalReport && degradation.kind.startsWith(JOURNAL_REPORT_SAMPLE_KIND_PREFIX))
    const sample = mayPresentPath ? safeSamplePath(degradation) : undefined
    if (sample && !entry.paths.includes(sample) && entry.paths.length < RESOURCE_DIAGNOSTIC_SAMPLE_LIMIT) {
      entry.paths.push(sample)
    }
    presented.set(classified.code, entry)
  }

  return [...presented]
    .filter(([, { count }]) => count > 0)
    .map(([code, { count, paths }]) => ({
      code,
      count,
      ...(paths.length > 0 ? { paths } : {})
    }))
}

/** Fold raw manifest detail into the closed, bounded presentation contract. */
export function presentDegradations(degradations: readonly DegradationInput[]): PresentedDegradation[] {
  return aggregateDegradations(degradations, false)
}

/** Read the compact internal report written to the durable restore journal. */
export function presentJournalDegradations(degradations: readonly DegradationInput[]): PresentedDegradation[] {
  return aggregateDegradations(degradations, true)
}

/**
 * Persist one summary plus at most three legacy-compatible `livePath` sample
 * lines per presentation code. True totals survive the relaunch without adding
 * another field to the strict v2 journal schema.
 */
export function compactDegradationsForJournal(degradations: readonly DegradationInput[]): JournalDegradation[] {
  return presentDegradations(degradations).flatMap(({ code, count, paths }) => [
    { kind: `${JOURNAL_REPORT_KIND_PREFIX}${code}`, reason: `${JOURNAL_REPORT_COUNT_PREFIX}${count}` },
    ...(paths ?? []).map((livePath) => ({
      kind: `${JOURNAL_REPORT_SAMPLE_KIND_PREFIX}${code}`,
      reason: 'sample',
      livePath
    }))
  ])
}
