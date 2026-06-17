/**
 * Markdown sanitize schema + SVG element/attribute allow-lists.
 *
 * Moved verbatim from src/renderer/src/components/chat/messages/markdown/Markdown.tsx
 * (lines 39-225). Extended `defaultSchema` allows the SVG subset Streamdown's
 * Mermaid plugin (and inline SVG content) emits, plus `<sup data-citation>`
 * for the citation pipeline.
 */

export const SVG_ELEMENT_REGEX = /<svg[\s>]/i
export const DISALLOWED_ELEMENTS = ['iframe', 'script']

export const SVG_ELEMENTS = [
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

export const SVG_ATTRIBUTES = [
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
  'xLinkHref',
  'xlink:href',
  'xmlns',
  'xmlnsXlink',
  'xmlns:xlink',
  'y1',
  'y2'
]

type SanitizeAttribute = string | [string, ...unknown[]]

export interface MarkdownSanitizeSchema {
  tagNames?: string[]
  attributes?: Record<string, SanitizeAttribute[] | undefined>
  protocols?: Record<string, string[] | null | undefined>
  strip?: string[]
  clobberPrefix?: string
  [key: string]: unknown
}

function mergeUnique<T>(...groups: readonly (readonly T[] | null | undefined)[]): T[] {
  return Array.from(new Set(groups.flatMap((group) => group ?? [])))
}

export function createMarkdownSanitizeSchema(schema: MarkdownSanitizeSchema): MarkdownSanitizeSchema {
  const svgAttributes = Object.fromEntries(
    SVG_ELEMENTS.map((tagName) => [tagName, mergeUnique(schema.attributes?.[tagName], SVG_ATTRIBUTES)])
  )
  const safeLinkProtocols = mergeUnique(schema.protocols?.href, ['http', 'https'])

  return {
    ...schema,
    tagNames: mergeUnique(schema.tagNames, ['span'], SVG_ELEMENTS),
    strip: mergeUnique(schema.strip, ['style']),
    attributes: {
      ...schema.attributes,
      span: mergeUnique(schema.attributes?.span, [
        'data-composer-token-index',
        'dataComposerTokenIndex',
        'data-composer-token-block',
        'dataComposerTokenBlock'
      ]),
      sup: mergeUnique(schema.attributes?.sup, ['data-citation']),
      ...svgAttributes
    },
    protocols: {
      ...schema.protocols,
      href: safeLinkProtocols,
      xlinkHref: safeLinkProtocols,
      xLinkHref: safeLinkProtocols,
      'xlink:href': safeLinkProtocols,
      src: mergeUnique(schema.protocols?.src, ['data'])
    }
  }
}
