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

/** Code (Shiki highlighting) + CJK line-break tweaks. */
export const defaultMarkdownPlugins: PluginConfig = {
  code,
  cjk
}

/** KaTeX math plugin. `singleDollar` enables `$x$` inline math (off by default). */
export function withMath(opts?: { singleDollar?: boolean }): PluginConfig['math'] {
  return createMathPlugin({ singleDollarTextMath: opts?.singleDollar ?? false })
}

/** Mermaid diagram plugin. Heavy — only import where actually rendered. */
export function withMermaid(): PluginConfig['mermaid'] {
  return mermaid
}

/**
 * Composer preset bundling all four plugins (code + cjk + math + mermaid).
 * Suitable for chat surfaces that render the full markdown surface.
 */
export function withChatPlugins(opts?: { singleDollarMath?: boolean }): PluginConfig {
  return {
    ...defaultMarkdownPlugins,
    math: withMath({ singleDollar: opts?.singleDollarMath ?? false }),
    mermaid: withMermaid()
  }
}
