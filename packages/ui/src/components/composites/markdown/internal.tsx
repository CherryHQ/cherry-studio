/**
 * Shared rendering body for `<Markdown>` and `<StreamingMarkdown>`. Builds
 * the rehype pipeline (defaultRehypePlugins → extended sanitize schema →
 * conditional SVG scaling → SVG ID prefixing → harden → heading IDs →
 * caller-supplied `extraRehypePlugins`) and hands `children`
 * to Streamdown verbatim. Any pre-processing (LaTeX bracket conversion,
 * SVG cleanup, citation tag injection) is the caller's responsibility —
 * the package stays provider-agnostic.
 */

import { type ReactElement, useCallback, useMemo } from 'react'
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
import {
  createMarkdownSanitizeSchema,
  DISALLOWED_ELEMENTS,
  type MarkdownSanitizeSchema,
  SVG_ELEMENT_REGEX
} from './utils'

const STREAMDOWN_DEFAULT_REMARK_PLUGINS = Object.values(defaultRemarkPlugins)

interface ResolvedDefaultRehypePlugins {
  raw: Pluggable
  sanitizeFn: Pluggable
  sanitizeSchema: MarkdownSanitizeSchema
  harden: Pluggable
}

function resolveDefaultRehypePlugins(): ResolvedDefaultRehypePlugins {
  const plugins = defaultRehypePlugins as Partial<Record<string, unknown>>
  const sanitize = plugins.sanitize

  if (!plugins.raw || !plugins.harden || !Array.isArray(sanitize) || sanitize.length < 2) {
    throw new Error('Unexpected Streamdown defaultRehypePlugins shape')
  }

  return {
    raw: plugins.raw as Pluggable,
    sanitizeFn: sanitize[0] as Pluggable,
    sanitizeSchema: sanitize[1] as MarkdownSanitizeSchema,
    harden: plugins.harden as Pluggable
  }
}

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
}: MarkdownCoreProps): ReactElement {
  const hasSvgElement = useMemo(() => SVG_ELEMENT_REGEX.test(children), [children])

  const remarkPlugins = useMemo(() => {
    const list: Pluggable[] = [...STREAMDOWN_DEFAULT_REMARK_PLUGINS, remarkAlert as Pluggable]
    if (extraRemarkPlugins?.length) list.push(...extraRemarkPlugins)
    return list
  }, [extraRemarkPlugins])

  const rehypePlugins = useMemo(() => {
    const { raw, sanitizeFn, sanitizeSchema, harden } = resolveDefaultRehypePlugins()
    const extendedSchema = createMarkdownSanitizeSchema(sanitizeSchema)
    const result: Pluggable[] = [raw]
    result.push(
      [sanitizeFn, extendedSchema] as Pluggable,
      ...(hasSvgElement ? ([rehypeScalableSvg] as Pluggable[]) : []),
      [rehypePrefixSvgReferences, (extendedSchema as { clobberPrefix?: string }).clobberPrefix] as Pluggable,
      harden,
      [rehypeHeadingIds, { prefix: `heading-${id}` }] as Pluggable
    )
    if (extraRehypePlugins?.length) result.push(...extraRehypePlugins)
    return result
  }, [hasSvgElement, id, extraRehypePlugins])

  const urlTransform = useCallback((value: string, key: string, node: Parameters<typeof defaultUrlTransform>[2]) => {
    if (key === 'src' && /^data:image\/(?:png|jpeg);/i.test(value)) return value
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
