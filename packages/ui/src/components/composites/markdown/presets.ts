/**
 * Plugin presets for Streamdown's `plugins` prop.
 *
 * Defaults to `code` + `cjk` (the most commonly needed for chat / docs UIs).
 * Math + Mermaid are opt-in via `withMath()` / `withMermaid()` so a
 * consumer that doesn't need them can avoid bundling KaTeX / Mermaid into
 * their tree-shaken build.
 */

import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import type { PluginConfig } from 'streamdown'

export interface WithMathOptions {
  singleDollar?: boolean
}

export interface WithFullMarkdownOptions {
  singleDollarMath?: boolean
}

/** Code (Shiki highlighting) + CJK line-break tweaks. */
export const defaultMarkdownPlugins: PluginConfig = {
  code,
  cjk
}

/** KaTeX math plugin. `singleDollar` enables `$x$` inline math (off by default). */
export function withMath(opts?: WithMathOptions): PluginConfig['math'] {
  return createMathPlugin({ singleDollarTextMath: opts?.singleDollar ?? false })
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
