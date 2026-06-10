import { createHash } from 'node:crypto'

const FIELD_SEPARATOR = ' '

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** Content hash binds normalized text to its normalization-contract version. */
export function hashContentText(text: string, normalizationVersion: number): string {
  return sha256Hex(`${normalizationVersion}${FIELD_SEPARATOR}${text}`)
}

/** Hash of the exact text fed to the embedding model — the `embedding` table key. */
export function hashEmbeddingText(text: string): string {
  return sha256Hex(text)
}

/**
 * Stable unit id: the same material / content / chunker result reproduces the
 * same id on rebuild. Excludes `chunker_config_hash` by design — a chunker
 * contract change is handled by `index_meta.chunker_config_hash` triggering a
 * full rebuild. See knowledge-technical-design.md §4.5.
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
