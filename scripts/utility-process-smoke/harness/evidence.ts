/** NDJSON evidence on stdout plus the host logger the engine writes through. */

import type { UtilityProcessHostLogger } from '../../../src/main/core/utilityProcess/host/ProcessHost'

export type EvidenceRecord = Record<string, unknown> & { event: string }

const variant = process.env.SMOKE_VARIANT ?? 'unknown'

export function record(entry: EvidenceRecord): void {
  process.stdout.write(`${JSON.stringify({ ...entry, variant })}\n`)
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
}

export interface RecordingLogger extends UtilityProcessHostLogger {
  /** Every entry the engine logged, newest last. */
  readonly entries: LogEntry[]
}

export function createEvidenceLogger(): RecordingLogger {
  const entries: LogEntry[] = []
  const write =
    (level: LogEntry['level']) =>
    (message: string): void => {
      entries.push({ level, message })
      record({ event: 'log', level, message })
    }
  return { entries, debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') }
}
