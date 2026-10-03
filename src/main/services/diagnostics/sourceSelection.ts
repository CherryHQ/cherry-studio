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

export function createDiagnosticBudgetSelector(limitBytes: number): {
  trySelect(candidate: DiagnosticBudgetCandidate<unknown>): boolean
} {
  const selectedPartKeys = new Set<string>()
  let remainingBytes = limitBytes

  const trySelect = (candidate: DiagnosticBudgetCandidate<unknown>): boolean => {
    const candidatePartKeys = new Set<string>()
    let bytes = 0
    for (const part of candidate.parts) {
      if (selectedPartKeys.has(part.key) || candidatePartKeys.has(part.key)) continue
      candidatePartKeys.add(part.key)
      bytes += part.bytes
    }
    if (bytes > remainingBytes) return false
    remainingBytes -= bytes
    for (const key of candidatePartKeys) selectedPartKeys.add(key)
    return true
  }

  return { trySelect }
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
