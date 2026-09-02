/** NDJSON evidence on stdout plus the host logger the engine writes through. */

import type { UtilityProcessHostLogger } from '../../../src/main/core/utilityProcess/host/ProcessHost'

export type EvidenceRecord = Record<string, unknown> & { event: string }

const variant = process.env.SMOKE_VARIANT ?? 'unknown'

export function record(entry: EvidenceRecord): void {
  process.stdout.write(`${JSON.stringify({ ...entry, variant })}\n`)
}

export interface RecordingLogger extends UtilityProcessHostLogger {
  /** Every message the engine logged, newest last. */
  readonly messages: string[]
}

export function createEvidenceLogger(): RecordingLogger {
  const messages: string[] = []
  const write =
    (level: string) =>
    (message: string): void => {
      messages.push(message)
      record({ event: 'log', level, message })
    }
  return { messages, debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') }
}
