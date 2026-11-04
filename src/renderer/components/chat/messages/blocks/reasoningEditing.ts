import type { CherryMessagePart } from '@shared/data/types/message'

const CHERRY_METADATA_KEY = 'cherry'

/**
 * Whether a reasoning part carries replay metadata from its provider (OpenAI
 * response item ids, Anthropic thought signatures, encrypted reasoning, ...).
 *
 * Such a part cannot be replayed once its text changes: the signature only
 * covers the original text, so serializers either reject it or skip the part.
 * Editing is therefore offered only for unsigned reasoning; Cherry's own timing
 * metadata does not count as a signature.
 */
export function hasSignedReasoningMetadata(part: CherryMessagePart): boolean {
  if (part.type !== 'reasoning') return false
  const providerMetadata = (part as { providerMetadata?: Record<string, unknown> }).providerMetadata
  if (!providerMetadata) return false
  return Object.keys(providerMetadata).some((key) => key !== CHERRY_METADATA_KEY)
}

/**
 * Replace the text of a single reasoning part in place, preserving the part's
 * position, cherry timing metadata, and every other part untouched.
 *
 * The provider metadata is dropped on purpose: it carries the ids, thought
 * signatures and encrypted payloads that sign the ORIGINAL text (see
 * `openaiResponsesItemId`, `grokReasoningReplay`, Gemini thought signatures).
 * Replaying an edited text under the old signature can be rejected by the
 * provider or silently ignored, so an edited thought must start unsigned. The
 * `cherry` sub-object only describes duration/start time and is kept.
 *
 * Returns the very same array when nothing changes so callers can skip a write.
 */
export function replaceReasoningPartText(
  parts: CherryMessagePart[],
  partIndex: number,
  text: string
): CherryMessagePart[] {
  const target = parts[partIndex]
  if (!target || target.type !== 'reasoning' || target.text === text) return parts

  const { providerMetadata, ...rest } = target as typeof target & {
    providerMetadata?: { cherry?: unknown }
  }
  const cherry = providerMetadata?.cherry

  return parts.map((part, index) => {
    if (index !== partIndex) return part
    return {
      ...rest,
      text,
      state: 'done',
      ...(cherry ? { providerMetadata: { cherry } } : {})
    } as CherryMessagePart
  })
}
