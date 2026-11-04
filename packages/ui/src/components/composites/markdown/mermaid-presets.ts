// Kept apart from presets.ts so consumers of the default presets never reference the Merman runtime;
// the WASM itself loads only when the first diagram renders.
import type { PluginConfig } from 'streamdown'

import { renderMermaidSvg } from '../../../lib/mermaid/runtime'
import { resolveMermaidTheme } from '../../../lib/mermaid/theme'
import { defaultMarkdownPlugins, withMath } from './presets'

export interface WithFullMarkdownOptions {
  singleDollarMath?: boolean
}

/** Mermaid diagram plugin backed by Merman, themed from the document's design tokens at render time. */
export function withMermaid(): PluginConfig['mermaid'] {
  return {
    name: 'mermaid',
    type: 'diagram',
    language: 'mermaid',
    getMermaid: () => ({
      initialize: () => {},
      render: async (id, source) => ({
        svg: await renderMermaidSvg(source, { diagramId: id, theme: resolveMermaidTheme(document.documentElement) })
      })
    })
  }
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
