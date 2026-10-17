import type { CherryMessagePart } from '@shared/data/types/message'
import type { DiagnosisResult } from '@shared/data/types/uiParts'
import { withCherryMeta } from '@shared/data/types/uiParts'

export function withMessagePartDiagnosis(
  parts: CherryMessagePart[],
  partIndex: number,
  diagnosis: DiagnosisResult
): CherryMessagePart[] | null {
  if (partIndex < 0 || partIndex >= parts.length) return null

  // The switch-narrowing at the call site can't reach here, so narrow to the
  // data-error part shape `withCherryMeta` type-checks the `diagnosis` field against.
  const target = parts[partIndex] as Extract<CherryMessagePart, { type: 'data-error' }>
  const updatedPart = withCherryMeta(target, { diagnosis })

  return parts.map((part, index) => (index === partIndex ? updatedPart : part))
}
