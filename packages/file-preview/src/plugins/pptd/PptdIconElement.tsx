import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PptdIcon } from './pptdFormat'
import { fetchPptdIcon, type PptdIconData } from './pptdIcon'
import { pptdColorToCss, type PptdStyleContext, resolvePptdColor } from './pptdStyle'

/** Only plain CSS color syntax may enter the serialized SVG string. */
function cssSafeColor(color: string | undefined): string {
  return color && /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|[a-zA-Z]+)$/.test(color) ? color : '#000000'
}

export function PptdIconElement({ element, context }: { element: PptdIcon; context: PptdStyleContext }) {
  const { t } = useTranslation()
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [icon, setIcon] = useState<PptdIconData | null | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    setIcon(undefined)
    void fetchPptdIcon(element.iconName, controller.signal).then((data) => {
      if (!controller.signal.aborted) setIcon(data)
    })
    return () => controller.abort()
  }, [element.iconName])

  if (icon === null) {
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
        {t('file_preview.pptd.unsupported_element', { id: element.elementId, type: element.iconName })}
      </div>
    )
  }
  if (icon === undefined) {
    return <div style={{ width: '100%', height: '100%' }} aria-hidden="true" />
  }

  const fill = element.fill
  let fillValue: string
  let gradientHtml = ''
  if (fill?.type === 'gradient' && fill.gradientType !== 'radial' && fill.stops.length > 0) {
    fillValue = `url(#${gradientId})`
    const stops = fill.stops
      .map(
        (stop) =>
          `<stop offset="${Math.round(stop.position * 100)}%" stop-color="${cssSafeColor(resolvePptdColor(stop.color, context))}"/>`
      )
      .join('')
    gradientHtml = `<defs><linearGradient id="${gradientId}" gradientTransform="rotate(${fill.angle ?? 0} 0.5 0.5)">${stops}</linearGradient></defs>`
  } else if (fill?.type === 'solid') {
    fillValue = pptdColorToCss(fill.color, context) ?? '#000000'
  } else if (fill?.type === 'gradient' && fill.stops.length > 0) {
    fillValue = pptdColorToCss(fill.stops[0].color, context) ?? '#000000'
  } else {
    fillValue = '#000000'
  }

  const border = element.border
  const stroke = border?.color ? pptdColorToCss(border.color, context) : undefined

  const shadow = element.shadow
  const filter = shadow
    ? `drop-shadow(${shadow.offset?.[0] ?? 2}px ${shadow.offset?.[1] ?? 2}px ${shadow.blur}px ${
        pptdColorToCss(shadow.color, context) ?? 'rgba(0,0,0,0.4)'
      })`
    : undefined

  const [, , vbW = 512] = icon.viewBox.split(/\s+/).map(Number)
  const strokeWidth = stroke ? ((border?.width ?? 1) * vbW) / Math.max(element.bounds[2], 1) : 0

  return (
    <svg
      viewBox={icon.viewBox}
      style={{ width: '100%', height: '100%', display: 'block', filter }}
      fill={fillValue}
      stroke={stroke}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: gradientHtml + icon.innerHtml }}
    />
  )
}
