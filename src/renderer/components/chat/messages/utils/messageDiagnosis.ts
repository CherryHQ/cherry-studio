import type { DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import type { CherryMessagePart } from '@shared/data/types/message'

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

  const target = parts[partIndex]
  const existing = ('providerMetadata' in target ? target.providerMetadata : undefined) as
    | { cherry?: Record<string, unknown> }
    | undefined
  const updatedPart = {
    ...target,
    providerMetadata: {
      ...existing,
      // AI SDK types provider metadata as JSONValue. Cherry metadata is JSON-safe,
      // but DiagnosisResult does not expose that index signature to TypeScript.
      cherry: { ...existing?.cherry, diagnosis: diagnosis as unknown as Record<string, unknown> }
    }
  } as CherryMessagePart

  return parts.map((part, index) => (index === partIndex ? updatedPart : part))
}
