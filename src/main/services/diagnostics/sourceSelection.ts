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

export function compareBudgetCandidates(
  a: DiagnosticBudgetCandidate<unknown>,
  b: DiagnosticBudgetCandidate<unknown>
): number {
  return b.latestAt - a.latestAt || (a.key > b.key ? 1 : a.key < b.key ? -1 : 0)
}

export interface DiagnosticBudgetSelectionResult {
  readonly selected: boolean
  readonly selectedPartKeys: string[]
}

export function createDiagnosticBudgetSelector(limitBytes: number): {
  trySelect(candidate: DiagnosticBudgetCandidate<unknown>): DiagnosticBudgetSelectionResult
} {
  const selectedPartKeys = new Set<string>()
  let remainingBytes = limitBytes

  const trySelect = (candidate: DiagnosticBudgetCandidate<unknown>): DiagnosticBudgetSelectionResult => {
    const candidatePartKeys = new Set<string>()
    const newlySelectedPartKeys: string[] = []
    let bytes = 0
    for (const part of candidate.parts) {
      if (selectedPartKeys.has(part.key) || candidatePartKeys.has(part.key)) continue
      candidatePartKeys.add(part.key)
      newlySelectedPartKeys.push(part.key)
      bytes += part.bytes
    }
    if (bytes > remainingBytes) return { selected: false, selectedPartKeys: [] }
    remainingBytes -= bytes
    for (const key of newlySelectedPartKeys) selectedPartKeys.add(key)
    return { selected: true, selectedPartKeys: newlySelectedPartKeys }
  }

  return { trySelect }
}

export function selectBudgetCandidates<T>(
  candidates: readonly DiagnosticBudgetCandidate<T>[],
  limitBytes: number
): { selected: T[]; omitted: T[] } {
  const sortedCandidates = [...candidates].sort(compareBudgetCandidates)
  const selected = new Set<DiagnosticBudgetCandidate<T>>()
  const selector = createDiagnosticBudgetSelector(limitBytes)

  const trySelect = (candidate: DiagnosticBudgetCandidate<T> | undefined): void => {
    if (!candidate || selected.has(candidate)) return
    if (!selector.trySelect(candidate).selected) return
    selected.add(candidate)
  }

  const sourceRepresentatives: DiagnosticBudgetCandidate<T>[] = []
  for (const kind of ['logs', 'traces', 'chatRecords'] as const) {
    const representative = sortedCandidates.find((candidate) => candidate.kind === kind)
    if (representative) sourceRepresentatives.push(representative)
  }
  for (const candidate of sourceRepresentatives.sort(compareBudgetCandidates)) trySelect(candidate)
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
    parts: [candidate.messageRecord, candidate.contextRecord].map((part) => ({ key: part.key, bytes: part.bytes }))
  }
}
