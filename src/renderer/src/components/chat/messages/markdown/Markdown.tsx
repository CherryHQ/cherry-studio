import 'katex/dist/katex.min.css'
import 'katex/dist/contrib/copy-tex'
import 'katex/dist/contrib/mhchem'
import 'remark-github-blockquote-alert/alert.css'
import 'streamdown/styles.css'

import ImageViewer from '@renderer/components/ImageViewer'
import MarkdownShadowDOMRenderer from '@renderer/components/MarkdownShadowDOMRenderer'
import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import type { MessageStatus } from '@shared/data/types/message'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { createMathPlugin } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { isEmpty } from 'lodash'
import { createContext, type FC, memo, use, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import remarkAlert from 'remark-github-blockquote-alert'
import {
  type Components,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  defaultUrlTransform,
  type PluginConfig,
  Streamdown
} from 'streamdown'
import type { Pluggable } from 'unified'
import { visit } from 'unist-util-visit'

import { useMessageRenderConfig } from '../MessageListProvider'
import CodeBlock from './CodeBlock'
import Link from './Link'
import MarkdownSvgRenderer from './MarkdownSvgRenderer'
import rehypeHeadingIds from './plugins/rehypeHeadingIds'
import rehypeScalableSvg from './plugins/rehypeScalableSvg'
import Table from './Table'

const SVG_ELEMENT_REGEX = /<svg[\s>]/i
const DISALLOWED_ELEMENTS = ['iframe', 'script']
const STREAMDOWN_DEFAULT_REMARK_PLUGINS = Object.values(defaultRemarkPlugins)
const SVG_ELEMENTS = [
  'svg',
  'defs',
  'desc',
  'title',
  'symbol',
  'use',
  'g',
  'circle',
  'clipPath',
  'ellipse',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComposite',
  'feDropShadow',
  'feFlood',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'feTile',
  'feTurbulence',
  'line',
  'linearGradient',
  'marker',
  'mask',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'stop',
  'text',
  'textPath',
  'tspan'
]
const SVG_ATTRIBUTES = [
  'aria-label',
  'baseFrequency',
  'className',
  'clipPath',
  'clip-path',
  'clipRule',
  'clip-rule',
  'colorInterpolationFilters',
  'color-interpolation-filters',
  'cx',
  'cy',
  'd',
  'data-needs-measurement',
  'dominantBaseline',
  'dominant-baseline',
  'dx',
  'dy',
  'fill',
  'fillOpacity',
  'fill-opacity',
  'fillRule',
  'fill-rule',
  'filter',
  'floodColor',
  'flood-color',
  'floodOpacity',
  'flood-opacity',
  'fontFamily',
  'font-family',
  'fontSize',
  'font-size',
  'fontStyle',
  'font-style',
  'fontWeight',
  'font-weight',
  'gradientTransform',
  'gradientUnits',
  'height',
  'href',
  'id',
  'in',
  'in2',
  'k1',
  'k2',
  'k3',
  'k4',
  'lengthAdjust',
  'markerEnd',
  'marker-end',
  'markerHeight',
  'markerMid',
  'marker-mid',
  'markerStart',
  'marker-start',
  'markerWidth',
  'mask',
  'mode',
  'numOctaves',
  'offset',
  'opacity',
  'operator',
  'orient',
  'pathLength',
  'patternContentUnits',
  'patternTransform',
  'patternUnits',
  'points',
  'preserveAspectRatio',
  'r',
  'refX',
  'refY',
  'result',
  'role',
  'rotate',
  'rx',
  'ry',
  'scale',
  'seed',
  'spreadMethod',
  'stdDeviation',
  'stitchTiles',
  'stopColor',
  'stop-color',
  'stopOpacity',
  'stop-opacity',
  'stroke',
  'strokeDasharray',
  'stroke-dasharray',
  'strokeDashoffset',
  'stroke-dashoffset',
  'strokeLinecap',
  'stroke-linecap',
  'strokeLinejoin',
  'stroke-linejoin',
  'strokeMiterlimit',
  'stroke-miterlimit',
  'strokeOpacity',
  'stroke-opacity',
  'strokeWidth',
  'stroke-width',
  'style',
  'surfaceScale',
  'targetX',
  'targetY',
  'textAnchor',
  'text-anchor',
  'textLength',
  'transform',
  'type',
  'values',
  'viewBox',
  'width',
  'x',
  'y',
  'x1',
  'x2',
  'xlinkHref',
  'xlink:href',
  'xmlns',
  'xmlnsXlink',
  'xmlns:xlink',
  'y1',
  'y2'
]

export function createMarkdownSanitizeSchema(schema: any) {
  const svgAttributes = Object.fromEntries(
    SVG_ELEMENTS.map((tagName) => [tagName, [...(schema.attributes?.[tagName] || []), ...SVG_ATTRIBUTES]])
  )

  return {
    ...schema,
    tagNames: [...(schema.tagNames || []), 'style', ...SVG_ELEMENTS],
    attributes: {
      ...schema.attributes,
      sup: [...(schema.attributes?.sup || []), 'data-citation'],
      ...svgAttributes
    },
    protocols: {
      ...schema.protocols,
      src: [...(schema.protocols?.src || []), 'data']
    }
  }
}

const rewriteSvgReference = (value: string, idMap: Map<string, string>) => {
  let rewritten = value.replace(/url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g, (match, quote, id) => {
    const prefixedId = idMap.get(id)
    return prefixedId ? `url(${quote}#${prefixedId}${quote})` : match
  })

  if (rewritten.startsWith('#')) {
    const id = rewritten.slice(1)
    const prefixedId = idMap.get(id)
    if (prefixedId) {
      rewritten = `#${prefixedId}`
    }
  }

  return rewritten
}

const rewriteSvgProperty = (value: unknown, idMap: Map<string, string>): unknown => {
  if (typeof value === 'string') {
    return rewriteSvgReference(value, idMap)
  }

  if (Array.isArray(value)) {
    return value.map((item) => rewriteSvgProperty(item, idMap))
  }

  return value
}

const walkElement = (node: any, visitor: (node: any) => void) => {
  if (!node || typeof node !== 'object') return

  if (node.type === 'element') {
    visitor(node)
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkElement(child, visitor)
    }
  }
}

export function rehypePrefixSvgReferences(clobberPrefix = 'user-content-') {
  return (tree: any) => {
    if (!clobberPrefix) return

    visit(tree, 'element', (svgNode: any) => {
      if (svgNode.tagName !== 'svg') return

      const idMap = new Map<string, string>()
      walkElement(svgNode, (node) => {
        const id = node.properties?.id
        if (typeof id === 'string' && id.startsWith(clobberPrefix)) {
          idMap.set(id.slice(clobberPrefix.length), id)
        }
      })

      if (idMap.size === 0) return

      walkElement(svgNode, (node) => {
        const properties = node.properties
        if (!properties) return

        for (const key of Object.keys(properties)) {
          properties[key] = rewriteSvgProperty(properties[key], idMap)
        }
      })
    })
  }
}

/**
 * Lightweight interface for Markdown rendering source.
 * Only requires id, content, and status; no dependency on MessageBlock types.
 */
export interface MarkdownSource {
  id: string
  content: string
  status: MessageStatus | 'streaming'
}

/**
 * Context providing raw markdown content to sub-components so they don't need
 * useResolveBlock or Redux lookups.
 */
export interface MarkdownBlockContextValue {
  content: string
}

export const MarkdownBlockContext = createContext<MarkdownBlockContextValue | null>(null)

export function useMarkdownBlockContext(): MarkdownBlockContextValue | null {
  return use(MarkdownBlockContext)
}

interface Props {
  block: MarkdownSource
  postProcess?: (text: string) => string
}

const Markdown: FC<Props> = ({ block, postProcess }) => {
  const { t } = useTranslation()
  const { mathEnableSingleDollar } = useMessageRenderConfig()
  const isStreaming = block.status === 'streaming'

  const plugins = useMemo<PluginConfig>(() => {
    return {
      code,
      cjk,
      math: createMathPlugin({ singleDollarTextMath: mathEnableSingleDollar }),
      mermaid
    }
  }, [mathEnableSingleDollar])

  const remarkPlugins = useMemo(() => {
    return [...STREAMDOWN_DEFAULT_REMARK_PLUGINS, remarkAlert as Pluggable]
  }, [])

  const messageContent = useMemo(() => {
    if (block.status === 'paused' && isEmpty(block.content)) {
      return t('message.chat.completion.paused')
    }
    const content = postProcess ? postProcess(block.content) : block.content
    return removeSvgEmptyLines(processLatexBrackets(content))
  }, [block.status, block.content, postProcess, t])
  const hasSvgElement = SVG_ELEMENT_REGEX.test(messageContent)
  const hasStyleElement = /<style\b[^>]*>/i.test(messageContent)

  const rehypePlugins = useMemo(() => {
    // Verified with streamdown@2.5.0: sanitize is [rehypeSanitize, schema].
    const { raw, sanitize, harden } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize
    const extendedSchema = createMarkdownSanitizeSchema(schema)
    const result: Pluggable[] = [raw]
    if (hasSvgElement) {
      result.push(rehypeScalableSvg)
    }
    result.push([sanitizeFn, extendedSchema], [rehypePrefixSvgReferences, extendedSchema.clobberPrefix], harden, [
      rehypeHeadingIds,
      { prefix: `heading-${block.id}` }
    ])
    return result
  }, [hasSvgElement, block.id])

  const components = useMemo(() => {
    const result: Partial<Components> = {
      a: (props: any) => <Link {...props} />,
      code: (props: any) => <CodeBlock {...props} blockId={block.id} />,
      table: (props: any) => <Table {...props} blockId={block.id} />,
      img: (props: any) => <ImageViewer style={{ maxWidth: 500, maxHeight: 500 }} {...props} />,
      pre: (props: any) => <pre style={{ overflow: 'visible' }} {...props} />,
      p: (props) => {
        const hasImage = props?.node?.children?.some((child: any) => child.tagName === 'img')
        if (hasImage) return <div {...props} />
        return <p {...props} />
      },
      svg: MarkdownSvgRenderer as Components['svg']
    }
    if (hasStyleElement) {
      result.style = MarkdownShadowDOMRenderer as Components['style']
    }
    return result
  }, [block.id, hasStyleElement])

  const urlTransform = useCallback((value: string, key: string, node: any) => {
    if (value.startsWith('data:image/png') || value.startsWith('data:image/jpeg')) return value
    return defaultUrlTransform(value, key, node)
  }, [])

  const markdownCtx = useMemo<MarkdownBlockContextValue>(() => ({ content: block.content }), [block.content])

  const remarkRehypeOptions = useMemo(
    () => ({
      footnoteLabel: t('common.footnotes'),
      footnoteLabelTagName: 'h4' as const,
      footnoteBackContent: ' '
    }),
    [t]
  )

  return (
    <MarkdownBlockContext value={markdownCtx}>
      <div className="markdown">
        <Streamdown
          plugins={plugins}
          rehypePlugins={rehypePlugins}
          remarkPlugins={remarkPlugins}
          components={components}
          disallowedElements={DISALLOWED_ELEMENTS}
          urlTransform={urlTransform}
          isAnimating={isStreaming}
          normalizeHtmlIndentation
          remarkRehypeOptions={remarkRehypeOptions}>
          {messageContent}
        </Streamdown>
      </div>
    </MarkdownBlockContext>
  )
}

export default memo(Markdown)
