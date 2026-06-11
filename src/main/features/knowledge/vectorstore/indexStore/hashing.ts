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
 * same id on rebuild. Excludes `chunker_config_hash` by design — the chunker
 * contract is fingerprinted once in `index_meta.chunker_config_hash` (written at
 * store open), so a future contract change is resolved by a full rebuild rather
 * than by baking the config into every unit id. See knowledge-technical-design.md §4.4.
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

/**
 * Fingerprint of the chunker configuration that affects how content is split,
 * stored in `index_meta.chunker_config_hash`. A change here means the stored
 * units no longer match the current contract (see {@link computeUnitId}).
 */
export function hashChunkerConfig(chunkSize: number, chunkOverlap: number): string {
  return sha256Hex([chunkSize, chunkOverlap].join(FIELD_SEPARATOR))
}
