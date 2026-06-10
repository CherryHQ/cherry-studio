/**
 * Shared rendering body for `<Markdown>` and `<StreamingMarkdown>`. Builds
 * the rehype pipeline (defaultRehypePlugins → conditional SVG scaling →
 * extended sanitize schema → SVG ID prefixing → harden → heading IDs →
 * optional animate plugin from the streaming wrapper) and hands `children`
 * to Streamdown verbatim. Any pre-processing (LaTeX bracket conversion,
 * SVG cleanup, citation tag injection) is the caller's responsibility —
 * the package stays provider-agnostic.
 */

import { useCallback, useMemo } from 'react'
import remarkAlert from 'remark-github-blockquote-alert'
import {
  type AnimateOptions,
  type Components,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  defaultUrlTransform,
  type PluginConfig,
  Streamdown
} from 'streamdown'
import type { Pluggable } from 'unified'

import { MarkdownBlockContext } from './context'
import { rehypeHeadingIds, rehypePrefixSvgReferences } from './plugins'
import rehypeScalableSvg from './plugins/rehype-scalable-svg'
import { createMarkdownSanitizeSchema, DISALLOWED_ELEMENTS, SVG_ELEMENT_REGEX } from './utils'

const STREAMDOWN_DEFAULT_REMARK_PLUGINS = Object.values(defaultRemarkPlugins)

export interface MarkdownCoreProps {
  id: string
  children: string
  /** Component overrides merged into Streamdown defaults at the call site. */
  components?: Partial<Components>
  /** Streamdown plugin presets (code / cjk / math / mermaid). */
  plugins?: PluginConfig
  /** Caller-supplied extra rehype plugins appended after the core pipeline. */
  extraRehypePlugins?: Pluggable[]
  /** Caller-supplied extra remark plugins appended after Streamdown defaults + remarkAlert. */
  extraRemarkPlugins?: Pluggable[]
  /** Animation config forwarded to Streamdown's built-in `animated` prop. */
  animated?: AnimateOptions | false
  mode: 'static' | 'streaming'
  /** Repair half-typed markdown at the tail (only meaningful in streaming mode). */
  parseIncompleteMarkdown?: boolean
  className?: string
  disallowedElements?: readonly string[]
  /** Override the default 'Footnotes' label (for i18n). */
  footnoteLabel?: string
}

export function MarkdownCore({
  id,
  children,
  components,
  plugins,
  extraRehypePlugins,
  extraRemarkPlugins,
  animated,
  mode,
  parseIncompleteMarkdown,
  className,
  disallowedElements = DISALLOWED_ELEMENTS,
  footnoteLabel = 'Footnotes'
}: MarkdownCoreProps) {
  const hasSvgElement = SVG_ELEMENT_REGEX.test(children)

  const remarkPlugins = useMemo(() => {
    const list: Pluggable[] = [...STREAMDOWN_DEFAULT_REMARK_PLUGINS, remarkAlert as Pluggable]
    if (extraRemarkPlugins?.length) list.push(...extraRemarkPlugins)
    return list
  }, [extraRemarkPlugins])

  const rehypePlugins = useMemo(() => {
    // Streamdown's `defaultRehypePlugins` is a record of `Pluggable` entries
    // keyed by name. Cast loosely so the merge code stays readable.
    const { raw, sanitize, harden } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize as [unknown, Record<string, unknown>]
    const extendedSchema = createMarkdownSanitizeSchema(schema)
    const result: Pluggable[] = [raw]
    if (hasSvgElement) result.push(rehypeScalableSvg)
    result.push(
      [sanitizeFn as Pluggable, extendedSchema] as Pluggable,
      [rehypePrefixSvgReferences, (extendedSchema as { clobberPrefix?: string }).clobberPrefix] as Pluggable,
      harden,
      [rehypeHeadingIds, { prefix: `heading-${id}` }] as Pluggable
    )
    if (extraRehypePlugins?.length) result.push(...extraRehypePlugins)
    return result
  }, [hasSvgElement, id, extraRehypePlugins])

  const urlTransform = useCallback((value: string, key: string, node: Parameters<typeof defaultUrlTransform>[2]) => {
    if (value.startsWith('data:image/png') || value.startsWith('data:image/jpeg')) return value
    return defaultUrlTransform(value, key, node)
  }, [])

  const remarkRehypeOptions = useMemo(
    () => ({
      footnoteLabel,
      footnoteLabelTagName: 'h4' as const,
      footnoteBackContent: ' '
    }),
    [footnoteLabel]
  )

  const markdownCtx = useMemo(() => ({ content: children }), [children])

  return (
    <MarkdownBlockContext value={markdownCtx}>
      <div className={['markdown', className].filter(Boolean).join(' ')}>
        <Streamdown
          mode={mode}
          plugins={plugins}
          rehypePlugins={rehypePlugins}
          remarkPlugins={remarkPlugins}
          components={components}
          disallowedElements={disallowedElements}
          urlTransform={urlTransform}
          parseIncompleteMarkdown={parseIncompleteMarkdown}
          normalizeHtmlIndentation
          remarkRehypeOptions={remarkRehypeOptions}
          animated={animated || undefined}
          isAnimating={!!animated && mode === 'streaming'}>
          {children}
        </Streamdown>
      </div>
    </MarkdownBlockContext>
  )
}
