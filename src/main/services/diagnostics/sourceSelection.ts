import type { ChatRecordCandidate } from './chatRecordCollector'
import type { DiagnosticSourceKind, SourceCandidate } from './types'

interface DiagnosticBudgetPart {
  readonly bytes: number
  readonly key: string
}

export interface DiagnosticBudgetCandidate<T> {
  readonly item: T
  readonly key: string
  readonly kind: DiagnosticSourceKind
  readonly latestAt: number
  readonly parts: readonly DiagnosticBudgetPart[]
}

function newestFirst<T>(a: DiagnosticBudgetCandidate<T>, b: DiagnosticBudgetCandidate<T>): number {
  return b.latestAt - a.latestAt || (a.key > b.key ? 1 : a.key < b.key ? -1 : 0)
}

function costToSelect<T>(candidate: DiagnosticBudgetCandidate<T>, selectedPartKeys: ReadonlySet<string>): number {
  const partKeys = new Set(selectedPartKeys)
  let bytes = 0
  for (const part of candidate.parts) {
    if (partKeys.has(part.key)) continue
    partKeys.add(part.key)
    bytes += part.bytes
  }
  return bytes
}

export function selectBudgetCandidates<T>(
  candidates: readonly DiagnosticBudgetCandidate<T>[],
  limitBytes: number
): { selected: T[]; omitted: T[] } {
  const sortedCandidates = [...candidates].sort(newestFirst)
  const selected = new Set<DiagnosticBudgetCandidate<T>>()
  const selectedPartKeys = new Set<string>()
  let remainingBytes = limitBytes

  const trySelect = (candidate: DiagnosticBudgetCandidate<T> | undefined): void => {
    if (!candidate || selected.has(candidate)) return
    const cost = costToSelect(candidate, selectedPartKeys)
    if (cost > remainingBytes) return
    selected.add(candidate)
    remainingBytes -= cost
    for (const part of candidate.parts) selectedPartKeys.add(part.key)
  }

  for (const kind of ['logs', 'traces', 'chatRecords'] as const) {
    trySelect(sortedCandidates.find((candidate) => candidate.kind === kind))
  }
  for (const candidate of sortedCandidates) trySelect(candidate)

  return {
    selected: sortedCandidates.filter((candidate) => selected.has(candidate)).map((candidate) => candidate.item),
    omitted: sortedCandidates.filter((candidate) => !selected.has(candidate)).map((candidate) => candidate.item)
  }
}

export function toFileBudgetCandidate(candidate: SourceCandidate): DiagnosticBudgetCandidate<SourceCandidate> {
  return {
    item: candidate,
    key: candidate.archiveName,
    kind: candidate.kind,
    latestAt: candidate.latestAt,
    parts: [{ key: candidate.archiveName, bytes: candidate.eligibleBytes }]
  }
}

export function toChatBudgetCandidate(candidate: ChatRecordCandidate): DiagnosticBudgetCandidate<ChatRecordCandidate> {
  return {
    item: candidate,
    key: candidate.id,
    kind: candidate.kind,
    latestAt: candidate.latestAt,
    parts: candidate.parts.map((part) => ({ key: part.key, bytes: part.bytes }))
  }
}
