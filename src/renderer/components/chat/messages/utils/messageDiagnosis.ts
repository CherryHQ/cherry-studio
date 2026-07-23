import type { CherryMessagePart } from '@shared/data/types/message'
import type { DiagnosisResult } from '@shared/data/types/uiParts'
import { withCherryMeta } from '@shared/data/types/uiParts'

const MESSAGE_PART_ID_PATTERN = /^(.+)-(?:part|block)-(\d+)$/

export function parseMessagePartId(partId: string): { messageId: string; partIndex: number } | null {
  const match = partId.match(MESSAGE_PART_ID_PATTERN)
  if (!match) return null

  return { messageId: match[1], partIndex: Number.parseInt(match[2], 10) }
}

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
