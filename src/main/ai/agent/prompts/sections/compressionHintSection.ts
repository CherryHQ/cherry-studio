import type { SectionContributor } from './types'

const COMPRESSION_HINT_TEXT = `<context-compression>
Older messages in this conversation may have been summarized into a \`<summary>...</summary>\` block. Treat the summary as authoritative for the events it describes.
</context-compression>`

/**
 * Informs the model that chef's compress stage may have collapsed
 * older history into a single summary block. Opt-in: only emitted when
 * compression is explicitly enabled in resolved context settings,
 * matching chef's own activation gate.
 */
export const compressionHintSection: SectionContributor = (ctx) => {
  const settings = ctx.contextSettings
  if (settings?.enabled !== true) return undefined
  if (settings.compress.enabled !== true) return undefined

  return {
    id: 'context_compression',
    text: COMPRESSION_HINT_TEXT,
    cacheable: true
  }
}
