/**
 * Plugin presets for Streamdown's `plugins` prop.
 *
 * Defaults to `code` + `cjk` (the most commonly needed for chat / docs UIs).
 * Math is opt-in at render time via `withMath()`, but its plugin is bundled with
 * this module. Mermaid presets live in `mermaid-presets.ts` so they stay out of
 * the bundle unless imported.
 */

import { cjk, type CjkPlugin } from '@streamdown/cjk'
import { createMathPlugin } from '@streamdown/math'
import type { PluginConfig } from 'streamdown'
import type { Pluggable } from 'unified'

import { createCodeHighlightPlugin, rehypeStreamingMath } from './plugins'

export interface WithMathOptions {
  singleDollar?: boolean
  /** Render the longest closed, valid prefix; keep final input errors visible when false. */
  streaming?: boolean
}

const cjkWithLiteralTildes: CjkPlugin = (() => {
  const remarkPluginsAfter = cjk.remarkPluginsAfter.map((plugin, index, plugins) =>
    index === plugins.length - 1 ? ([plugin, { singleTilde: false }] as Pluggable) : plugin
  )

  return {
    ...cjk,
    remarkPluginsAfter,
    remarkPlugins: [...cjk.remarkPluginsBefore, ...remarkPluginsAfter]
  }
})()

/** Code (Highlights highlighting) + CJK line-break tweaks. */
export const defaultMarkdownPlugins: PluginConfig = {
  code: createCodeHighlightPlugin(),
  cjk: cjkWithLiteralTildes
}

/** KaTeX math plugin. `singleDollar` enables `$x$` inline math (off by default). */
export function withMath(opts?: WithMathOptions): PluginConfig['math'] {
  const math = createMathPlugin({ singleDollarTextMath: opts?.singleDollar ?? false })
  return opts?.streaming ? { ...math, rehypePlugin: [rehypeStreamingMath, math.rehypePlugin] } : math
}
