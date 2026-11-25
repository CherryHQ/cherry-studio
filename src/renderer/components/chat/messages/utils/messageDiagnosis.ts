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
  const target = parts[partIndex]

  if (target?.type !== 'data-error') return null

  const updatedPart = withCherryMeta(target, { diagnosis })

  return parts.map((part, index) => (index === partIndex ? updatedPart : part))
}
