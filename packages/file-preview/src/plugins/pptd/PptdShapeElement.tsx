import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { PptdShape } from './pptdFormat'
import { pptdShapeFillRule, pptdShapePath } from './pptdShapes'
import { pptdColorToCss, type PptdStyleContext, resolvePptdColor } from './pptdStyle'

function gradientAngleTransform(angleDeg: number): string {
  // The reference measures linear gradient angles clockwise from the x axis;
  // SVG gradients run along the x axis, so rotate the gradient around center.
  return `rotate(${angleDeg} 0.5 0.5)`
}

export function PptdShapeElement({ element, context }: { element: PptdShape; context: PptdStyleContext }) {
  const { t } = useTranslation()
  const gradientId = useId()
  const custom = element.path && element.viewBox ? { path: element.path, viewBox: element.viewBox } : null
  const path = custom?.path ?? pptdShapePath(element.shapeName, element.adjustments)

  if (!path) {
    return (
      <div
        role="note"
        style={{
          width: '100%',
          height: '100%',
          border: '1px dashed #B45309',
          color: '#B45309',
          fontSize: 11,
          overflow: 'hidden'
        }}>
        {t('file_preview.pptd.unsupported_element', { id: element.elementId, type: element.shapeName })}
      </div>
    )
  }

  const fill = element.fill
  let fillAttr: string
  let gradientDef: React.ReactNode = null
  if (fill?.type === 'solid') {
    fillAttr = pptdColorToCss(fill.color, context) ?? 'none'
  } else if (fill?.type === 'gradient' && fill.gradientType !== 'radial' && fill.stops.length > 0) {
    fillAttr = `url(#${gradientId})`
    gradientDef = (
      <linearGradient id={gradientId} gradientTransform={gradientAngleTransform(fill.angle ?? 0)}>
        {fill.stops.map((stop, index) => (
          <stop
            key={index}
            offset={`${Math.round(stop.position * 100)}%`}
            stopColor={resolvePptdColor(stop.color, context) ?? '#000000'}
          />
        ))}
      </linearGradient>
    )
  } else if (fill?.type === 'gradient' && fill.stops.length > 0) {
    // Radial gradients and image fills approximate to the first stop color.
    fillAttr = pptdColorToCss(fill.stops[0].color, context) ?? 'none'
  } else {
    fillAttr = pptdColorToCss('$primary', context) ?? '#4472C4'
  }

  const border = element.border
  const stroke = border?.color ? pptdColorToCss(border.color, context) : undefined
  const strokeWidth = border?.width ?? (stroke ? 1 : 0)
  const dasharray = border?.style === 'dash' ? '8 6' : border?.style === 'dot' ? '2 4' : undefined

  const shadow = element.shadow
  const filter = shadow
    ? `drop-shadow(${shadow.offset?.[0] ?? 2}px ${shadow.offset?.[1] ?? 2}px ${shadow.blur ?? 4}px ${
        pptdColorToCss(shadow.color ?? '#00000066', context) ?? 'rgba(0,0,0,0.4)'
      })`
    : undefined

  const [vbW, vbH] = custom?.viewBox ?? [100000, 100000]
  const scaleStroke = stroke && strokeWidth > 0 ? (strokeWidth * 100000) / Math.max(element.bounds[2], 1) : strokeWidth

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block', filter, overflow: 'visible' }}
      aria-hidden="true">
      {gradientDef ? <defs>{gradientDef}</defs> : null}
      <path
        d={path}
        fill={fillAttr}
        fillRule={custom ? 'nonzero' : pptdShapeFillRule(element.shapeName)}
        stroke={stroke}
        strokeWidth={scaleStroke}
        strokeDasharray={dasharray}
      />
    </svg>
  )
}
