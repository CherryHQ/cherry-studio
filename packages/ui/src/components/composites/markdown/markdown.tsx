/**
 * Static markdown renderer.
 *
 * - Streamdown `mode="static"` — no incomplete-markdown repair, no animation
 *   plugin in the rehype pipeline, no streaming caret.
 * - Use for paste-once content where the source string is final at render
 *   time (release notes, system messages, settings descriptions, etc.).
 * - For chat assistant output that grows token-by-token, use `StreamingMarkdown`.
 */

import type { ReactElement } from 'react'
import type { Components, PluginConfig } from 'streamdown'
import type { Pluggable } from 'unified'

import { MarkdownCore } from './internal'

export interface MarkdownProps {
  /** Stable identity used as heading-ID prefix + block memoization key. */
  id: string
  /** Markdown source. */
  children: string
  /** Component overrides forwarded to Streamdown. */
  components?: Partial<Components>
  /** Streamdown plugin presets (code / cjk / math / mermaid). */
  plugins?: PluginConfig
  /** Extra rehype plugins appended after the core sanitize + heading-ID pipeline. */
  rehypePlugins?: Pluggable[]
  /** Extra remark plugins appended after Streamdown defaults + remarkAlert. */
  remarkPlugins?: Pluggable[]
  disallowedElements?: readonly string[]
  className?: string
  /** Override the default 'Footnotes' label for i18n. */
  footnoteLabel?: string
}

export function Markdown({
  id,
  children,
  components,
  plugins,
  rehypePlugins,
  remarkPlugins,
  disallowedElements,
  className,
  footnoteLabel
}: MarkdownProps): ReactElement {
  return (
    <MarkdownCore
      id={id}
      mode="static"
      components={components}
      plugins={plugins}
      extraRehypePlugins={rehypePlugins}
      extraRemarkPlugins={remarkPlugins}
      disallowedElements={disallowedElements}
      className={className}
      footnoteLabel={footnoteLabel}>
      {children}
    </MarkdownCore>
  )
}
