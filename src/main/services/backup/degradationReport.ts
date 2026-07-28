import type { JournalDegradation } from '@data/db/restore/restoreJournal'

type Code = 'capability-malformed' | 'external-file-dropped' | 'path-unportable' | 'path-collision' | 'unknown'
export interface PresentedDegradation {
  readonly code: Code
  readonly count: number
}

function classify(reason: string): Code {
  const matched = /^(capability-malformed|external-file-dropped|path-unportable|path-collision) \(\d+ rows?\)$/.exec(
    reason
  )
  return (matched?.[1] as Code | undefined) ?? 'unknown'
}

/** Removes archive/database detail before presentation crosses IPC. */
export function presentJournalDegradations(degradations: readonly JournalDegradation[]): PresentedDegradation[] {
  const totals = new Map<Code, number>()
  for (const degradation of degradations) {
    const code = classify(degradation.reason)
    totals.set(code, (totals.get(code) ?? 0) + 1)
  }
  return [...totals].map(([code, count]) => ({ code, count }))
}
