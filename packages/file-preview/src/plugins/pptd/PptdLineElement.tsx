import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { PptdArrowType, PptdLine } from './pptdFormat'
import { parsePptdLinePoints, pptdLinePath } from './pptdLine'
import { pptdColorToCss, type PptdStyleContext } from './pptdStyle'

const ARROW_PATHS: Record<PptdArrowType, { d: string; filled: boolean }> = {
  arrow: { d: 'M0,1 L9,5 L0,9', filled: false },
  stealth: { d: 'M0,1 L9,5 L0,9 L3,5 Z', filled: true },
  diamond: { d: 'M1,5 L5,1 L9,5 L5,9 Z', filled: true },
  oval: { d: 'M5,1 A4,4 0 1 1 4.99,1 Z', filled: true }
}

function ArrowMarker({ id, type, color, start }: { id: string; type: PptdArrowType; color: string; start: boolean }) {
  const { d, filled } = ARROW_PATHS[type]
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX={start ? 1 : 9}
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient={start ? 'auto-start-reverse' : 'auto'}>
      <path d={d} fill={filled ? color : 'none'} stroke={color} strokeWidth={filled ? 0 : 1.4} />
    </marker>
  )
}

export function PptdLineElement({ element, context }: { element: PptdLine; context: PptdStyleContext }) {
  const { t } = useTranslation()
  const markerBase = useId().replace(/[^a-zA-Z0-9]/g, '')
  const points = parsePptdLinePoints(element.points)
  const path = pptdLinePath(points, element.curve ?? 'round')

  if (!path) {
    return (
      <div
        role="note"
        style={{ width: '100%', height: '100%', border: '1px dashed #B45309', color: '#B45309', fontSize: 11 }}>
        {t('file_preview.pptd.unsupported_element', { id: element.elementId, type: element.elementType })}
      </div>
    )
  }

  const border = element.border
  const stroke = pptdColorToCss(border?.color ?? '$primary', context) ?? '#4472C4'
  const [vbW] = element.viewBox
  const strokeWidth = ((border?.width ?? 2) * vbW) / Math.max(element.bounds[2], 1)
  const dasharray = border?.style === 'dash' ? '8 6' : border?.style === 'dot' ? '2 4' : undefined

  const shadow = element.shadow
  const filter = shadow
    ? `drop-shadow(${shadow.offset?.[0] ?? 2}px ${shadow.offset?.[1] ?? 2}px ${shadow.blur}px ${
        pptdColorToCss(shadow.color, context) ?? 'rgba(0,0,0,0.4)'
      })`
    : undefined

  const [startArrow, endArrow] = element.arrow ?? [null, null]
  const startId = `${markerBase}-s`
  const endId = `${markerBase}-e`

  return (
    <svg
      viewBox={`0 0 ${element.viewBox[0]} ${element.viewBox[1]}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block', filter, overflow: 'visible' }}
      aria-hidden="true">
      <defs>
        {startArrow ? <ArrowMarker id={startId} type={startArrow} color={stroke} start /> : null}
        {endArrow ? <ArrowMarker id={endId} type={endArrow} color={stroke} start={false} /> : null}
      </defs>
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dasharray}
        strokeLinecap={element.curve === 'sharp' ? 'butt' : 'round'}
        strokeLinejoin={element.curve === 'sharp' ? 'miter' : 'round'}
        markerStart={startArrow ? `url(#${startId})` : undefined}
        markerEnd={endArrow ? `url(#${endId})` : undefined}
      />
    </svg>
  )
}
