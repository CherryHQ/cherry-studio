import { type ReactElement, useMemo } from 'react'
import type { AnimateOptions, Components, PluginConfig } from 'streamdown'
import type { Pluggable } from 'unified'

import { MarkdownCore } from './internal'

export interface StreamingMarkdownProps {
  /** Stable identity used as heading-ID prefix. */
  id: string
  /** Markdown source (the streaming tail). */
  children: string
  components?: Partial<Components>
  plugins?: PluginConfig
  rehypePlugins?: Pluggable[]
  remarkPlugins?: Pluggable[]
  disallowedElements?: readonly string[]
  className?: string
  footnoteLabel?: string
  animated?: false | AnimateOptions
  parseIncompleteMarkdown?: boolean
}

const DEFAULT_ANIMATED: AnimateOptions = {
  animation: 'fadeIn',
  duration: 250,
  easing: 'ease-out'
}

export function StreamingMarkdown({
  id,
  children,
  components,
  plugins,
  rehypePlugins,
  remarkPlugins,
  disallowedElements,
  className,
  footnoteLabel,
  animated,
  parseIncompleteMarkdown = true
}: StreamingMarkdownProps): ReactElement {
  // Stable reference so Streamdown's internal memo on JSON.stringify(animated)
  // sees the same identity across renders.
  const resolvedAnimated = useMemo<AnimateOptions | false>(
    () => (animated === false ? false : (animated ?? DEFAULT_ANIMATED)),
    [animated]
  )

  return (
    <MarkdownCore
      id={id}
      mode="streaming"
      parseIncompleteMarkdown={parseIncompleteMarkdown}
      components={components}
      plugins={plugins}
      extraRehypePlugins={rehypePlugins}
      extraRemarkPlugins={remarkPlugins}
      animated={resolvedAnimated}
      disallowedElements={disallowedElements}
      className={className}
      footnoteLabel={footnoteLabel}>
      {children}
    </MarkdownCore>
  )
}
