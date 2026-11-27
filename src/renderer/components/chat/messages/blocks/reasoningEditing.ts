import type { CherryMessagePart } from '@shared/data/types/message'

const CHERRY_METADATA_KEY = 'cherry'

const THINK_REPLAY_MARKER = 'think'

/**
 * Whether a reasoning part carries replay metadata from its provider (OpenAI
 * response item ids, Anthropic thought signatures, encrypted reasoning, ...).
 *
 * Such a part cannot be replayed as native reasoning once its text changes: the
 * signature only covers the original text, so serializers either reject it or
 * skip the part. Signed parts are therefore replayed as plain `<think>` text
 * (see `replaceReasoningPartText`); Cherry's own timing metadata does not count
 * as a signature.
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
 * provider or silently ignored.
 *
 * Signed reasoning is instead marked for replay as plain `<think>` text: the
 * main-process message pipeline renders the marker into an assistant text part
 * before serialization, so the model still sees the corrected thought without
 * an invalid signature. Unsigned reasoning keeps its native replay and gets no
 * marker. The `cherry` sub-object also keeps duration/start time.
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
  const cherry = (providerMetadata?.cherry ?? {}) as Record<string, unknown>
  const replayAsThink = hasSignedReasoningMetadata(target) || cherry.editedReasoningReplay === THINK_REPLAY_MARKER
  const nextCherry = replayAsThink ? { ...cherry, editedReasoningReplay: THINK_REPLAY_MARKER } : cherry

  return parts.map((part, index) => {
    if (index !== partIndex) return part
    return {
      ...rest,
      text,
      state: 'done',
      ...(Object.keys(nextCherry).length > 0 ? { providerMetadata: { cherry: nextCherry } } : {})
    } as CherryMessagePart
  })
}
