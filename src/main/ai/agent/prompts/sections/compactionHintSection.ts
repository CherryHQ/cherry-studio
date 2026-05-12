import type { SectionContributor } from './types'

const COMPACTION_HINT_TEXT = `<context-compaction>
Earlier reasoning blocks in this conversation may have been removed to save context budget. Treat the visible conversation history as canonical; do not refer back to internal thinking that is no longer present.
</context-compaction>`

/**
 * Warns the model that prior reasoning / thinking blocks may have been
 * pruned by chef's compact stage. Without this hint a model that
 * remembers it produced an internal thought may try to cite something
 * the next iteration can't see.
 *
 * Gated only on the master `contextSettings.enabled` flag — compact
 * is always-on whenever chef is enabled.
 */
export const compactionHintSection: SectionContributor = (ctx) => {
  if (ctx.contextSettings?.enabled !== true) return undefined

  return {
    id: 'context_compaction',
    text: COMPACTION_HINT_TEXT,
    cacheable: true
  }
}
