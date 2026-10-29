// Kept apart from presets.ts: `@streamdown/mermaid` statically imports mermaid and is not
// tree-shakeable, so any consumer of the default presets would otherwise bundle it eagerly.
import { mermaid } from '@streamdown/mermaid'
import type { PluginConfig } from 'streamdown'

import { defaultMarkdownPlugins, withMath } from './presets'

export interface WithFullMarkdownOptions {
  singleDollarMath?: boolean
}

/** Mermaid diagram plugin. Heavy — only import where actually rendered. */
export function withMermaid(): PluginConfig['mermaid'] {
  return mermaid
}

/**
 * Composer preset bundling all four plugins (code + cjk + math + mermaid).
 * Suitable for consumers that render the full markdown surface.
 */
export function withFullMarkdown(opts?: WithFullMarkdownOptions): PluginConfig {
  return {
    ...defaultMarkdownPlugins,
    math: withMath({ singleDollar: opts?.singleDollarMath ?? false }),
    mermaid: withMermaid()
  }
}

/**
 * @deprecated Use `withFullMarkdown`. Kept as a compatibility alias for
 * downstream branches that still import this preset from the markdown barrel.
 */
export const withChatPlugins = withFullMarkdown
