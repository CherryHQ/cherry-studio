import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildPptdChartOption } from './pptdChart'
import type { PptdBorder, PptdChart, PptdFill, PptdShadow } from './pptdFormat'
import { pptdColorToCss, pptdFillToCss, type PptdStyleContext } from './pptdStyle'

export function PptdChartElement({
  element,
  context,
  staticPreview = false
}: {
  element: PptdChart
  context: PptdStyleContext
  /** Thumbnail mode: no echarts instance, just a light stand-in. */
  staticPreview?: boolean
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [supported] = useState(() => buildPptdChartOption(element, context) !== null)

  // The chart schema is loose; the frame fields follow the shared schemas.
  const frame = element as unknown as { fill?: PptdFill; border?: PptdBorder; shadow?: PptdShadow }
  const border = frame.border
  const shadow = frame.shadow
  const frameStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    ...pptdFillToCss(frame.fill, context),
    ...(border
      ? {
          border: `${border.width ?? 1}px ${border.style === 'dash' ? 'dashed' : border.style === 'dot' ? 'dotted' : 'solid'} ${
            pptdColorToCss(border.color ?? '#000000', context) ?? '#000000'
          }`
        }
      : {}),
    ...(shadow
      ? {
          filter: `drop-shadow(${shadow.offset?.[0] ?? 2}px ${shadow.offset?.[1] ?? 2}px ${shadow.blur}px ${
            pptdColorToCss(shadow.color, context) ?? 'rgba(0,0,0,0.4)'
          })`
        }
      : {})
  }

  useEffect(() => {
    if (!supported || !containerRef.current) return
    let dispose: (() => void) | undefined
    let cancelled = false
    // Lazy-load echarts so it stays out of the main bundle (spreadsheet pattern).
    void import('./PptdChartRenderer').then((module) => {
      if (cancelled || !containerRef.current) return
      dispose = module.renderPptdChart(element, context, containerRef.current)
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [element, context, supported])

  if (staticPreview) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-muted/40 text-xs text-muted-foreground"
        aria-hidden="true">
        {t('file_preview.pptd.chart_thumbnail')}
      </div>
    )
  }

  if (!supported) {
    const types = ((element as unknown as { series?: { type?: string }[] }).series ?? [])
      .map((series) => series.type)
      .filter(Boolean)
      .join(', ')
    return (
      <div
        role="note"
        style={{
          ...frameStyle,
          border: '1px dashed #B45309',
          color: '#B45309',
          fontSize: 11
        }}>
        {t('file_preview.pptd.unsupported_element', { id: element.elementId, type: types || element.elementType })}
      </div>
    )
  }

  return <div ref={containerRef} style={frameStyle} />
}
