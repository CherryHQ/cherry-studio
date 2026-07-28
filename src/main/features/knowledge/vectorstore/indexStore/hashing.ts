import { createHash } from 'node:crypto'

const FIELD_SEPARATOR = ' '

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Content hash of the normalized text. The text already reflects the active
 * normalization rules, so the rule version is not folded in (and not tracked). */
export function hashContentText(text: string): string {
  return sha256Hex(text)
}

/** Hash of the exact text fed to the embedding model — the `embedding` table key. */
export function hashEmbeddingText(text: string): string {
  return sha256Hex(text)
}

/**
 * Stable unit id: the same material / content / chunker result reproduces the
 * same id on rebuild. Excludes the chunker config by design — a future contract
 * change is resolved by a full rebuild of the throwaway index rather than by
 * baking the config into every unit id. See knowledge-technical-design.md §4.4.
 */
export function computeUnitId(
  materialId: string,
  contentHash: string,
  unitType: string,
  unitIndex: number,
  charStart: number,
  charEnd: number
): string {
  return sha256Hex([materialId, contentHash, unitType, unitIndex, charStart, charEnd].join(FIELD_SEPARATOR))
}

/** Stable `search_text` id derived from its (target_type, target_id, kind) unique key. */
export function computeSearchTextId(targetType: string, targetId: string, kind: string): string {
  return sha256Hex([targetType, targetId, kind].join(FIELD_SEPARATOR))
}
