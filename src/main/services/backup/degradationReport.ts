import type { JournalDegradation } from '@data/db/restore/restoreJournal'
import type { BackupDegradationCode } from '@shared/ipc/schemas/backup'

export interface PresentedDegradation {
  readonly code: BackupDegradationCode
  readonly count: number
}

type DegradationOrigin = 'export-db' | 'restore-db'
type DegradationInput = Pick<JournalDegradation, 'kind' | 'reason'>

const REPORT_KIND =
  /^report:(export-db|restore-db):(capability-malformed|external-file-dropped|path-unportable|path-collision|unknown)$/
const MATERIALIZATION_REASON = /^([a-z-]+) \((\d+) rows?\)$/
const KNOWN_CODES = new Set<BackupDegradationCode>([
  'capability-malformed',
  'external-file-dropped',
  'path-unportable',
  'path-collision'
])
const REPORT_COUNT = /^count:(\d+)$/

function parsedCount(value: string): number | undefined {
  const matched = REPORT_COUNT.exec(value)
  if (!matched) return undefined
  const count = Number(matched[1])
  return Number.isSafeInteger(count) && count > 0 ? count : undefined
}

function originOf(kind: string): DegradationOrigin {
  return kind.startsWith('portable-db:') || kind.startsWith('report:export-db:') ? 'export-db' : 'restore-db'
}

function classify({ reason }: DegradationInput): PresentedDegradation {
  const matched = MATERIALIZATION_REASON.exec(reason)
  if (!matched) return { code: 'unknown', count: 1 }
  const count = Number(matched[2])
  return {
    code: KNOWN_CODES.has(matched[1] as BackupDegradationCode) ? (matched[1] as BackupDegradationCode) : 'unknown',
    count: Number.isSafeInteger(count) && count > 0 ? count : 1
  }
}

function add(totals: Map<BackupDegradationCode, number>, { code, count }: PresentedDegradation): void {
  const total = (totals.get(code) ?? 0) + count
  totals.set(code, Number.isSafeInteger(total) ? total : Number.MAX_SAFE_INTEGER)
}

/** Collapses materialization report lines to the archive's closed, path-free contract. */
export function presentDegradations(degradations: readonly DegradationInput[]): PresentedDegradation[] {
  const totals = new Map<BackupDegradationCode, number>()
  for (const degradation of degradations) add(totals, classify(degradation))
  return [...totals].map(([code, count]) => ({ code, count }))
}

/** Encodes producer-side archive reductions with their origin for the restore journal. */
export function manifestDegradationsForJournal(degradations: readonly PresentedDegradation[]): JournalDegradation[] {
  return degradations.map(({ code, count }) => ({ kind: `report:export-db:${code}`, reason: `count:${count}` }))
}

/**
 * Reduces restore-time details to one closed report per origin/code before the
 * journal crosses a relaunch. Unknown reasons (including external-workspace-reset)
 * intentionally remain `unknown` rather than creating a speculative UI contract.
 */
export function compactDegradationsForJournal(degradations: readonly DegradationInput[]): JournalDegradation[] {
  const totals = new Map<string, PresentedDegradation>()
  for (const degradation of degradations) {
    const report = REPORT_KIND.exec(degradation.kind)
    const origin = report?.[1] ?? originOf(degradation.kind)
    const classified = report
      ? { code: report[2] as BackupDegradationCode, count: parsedCount(degradation.reason) ?? 1 }
      : classify(degradation)
    const key = `${origin}:${classified.code}`
    const current = totals.get(key)
    totals.set(
      key,
      current
        ? { code: current.code, count: Math.min(Number.MAX_SAFE_INTEGER, current.count + classified.count) }
        : classified
    )
  }
  return [...totals].map(([key, { count }]) => ({ kind: `report:${key}`, reason: `count:${count}` }))
}

/** Removes archive/database details while retaining exact degradation totals. */
export function presentJournalDegradations(degradations: readonly DegradationInput[]): PresentedDegradation[] {
  const totals = new Map<BackupDegradationCode, number>()
  for (const degradation of degradations) {
    const report = REPORT_KIND.exec(degradation.kind)
    add(
      totals,
      report
        ? { code: report[2] as BackupDegradationCode, count: parsedCount(degradation.reason) ?? 1 }
        : classify(degradation)
    )
  }
  return [...totals].map(([code, count]) => ({ code, count }))
}
