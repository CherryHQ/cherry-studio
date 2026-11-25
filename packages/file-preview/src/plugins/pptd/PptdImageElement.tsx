import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PptdImage } from './pptdFormat'
import { pptdImageRect } from './pptdImage'
import type { PptdProjectFileReader } from './pptdProject'
import { pptdShapeFillRule, pptdShapePath } from './pptdShapes'
import { pptdColorToCss, type PptdStyleContext } from './pptdStyle'
import { usePptdMediaUrl } from './usePptdMedia'

export function PptdImageElement({
  element,
  context,
  readProjectFile
}: {
  element: PptdImage
  context: PptdStyleContext
  readProjectFile?: PptdProjectFileReader
}) {
  const { t } = useTranslation()
  const clipId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const media = usePptdMediaUrl(readProjectFile, element.src)
  const [natural, setNatural] = useState<readonly [number, number] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const [, , boxW, boxH] = element.bounds

  if (media.error || failed) {
    // AC5: a broken or unreadable image renders a visible placeholder, never nothing.
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
        {t('file_preview.pptd.image_unavailable', { id: element.elementId, src: element.src })}
      </div>
    )
  }

  const cropShape = element.cropShape
  const custom = cropShape?.shapeName === 'custom' && cropShape.viewBox && cropShape.path ? cropShape : null
  const clipPath = custom
    ? {
        d: custom.path!,
        scaleX: boxW / custom.viewBox![0],
        scaleY: boxH / custom.viewBox![1],
        fillRule: 'nonzero' as const
      }
    : cropShape
      ? (() => {
          const d = pptdShapePath(cropShape.shapeName, cropShape.adjustments)
          return d
            ? { d, scaleX: boxW / 100000, scaleY: boxH / 100000, fillRule: pptdShapeFillRule(cropShape.shapeName) }
            : null
        })()
      : null

  const rect = natural ? pptdImageRect(natural[0], natural[1], boxW, boxH, element.crop, element.fit) : null

  const border = element.border
  const stroke = border?.color ? pptdColorToCss(border.color, context) : undefined
  const strokeWidth = border?.width ?? (stroke ? 1 : 0)
  const dasharray = border?.style === 'dash' ? '8 6' : border?.style === 'dot' ? '2 4' : undefined

  const shadow = element.shadow
  const filter = shadow
    ? `drop-shadow(${shadow.offset?.[0] ?? 2}px ${shadow.offset?.[1] ?? 2}px ${shadow.blur}px ${
        pptdColorToCss(shadow.color, context) ?? 'rgba(0,0,0,0.4)'
      })`
    : undefined

  const borderPath = clipPath ?? {
    d: `M0,0H${boxW}V${boxH}H0Z`,
    scaleX: 1,
    scaleY: 1,
    fillRule: 'nonzero' as const
  }

  return (
    <div style={{ width: '100%', height: '100%', filter }}>
      {media.url && !natural ? (
        <img
          src={media.url}
          alt=""
          style={{ display: 'none' }}
          onLoad={(event) => {
            const img = event.currentTarget
            setNatural([img.naturalWidth, img.naturalHeight])
          }}
          onError={() => setFailed(element.src)}
        />
      ) : null}
      <svg
        viewBox={`0 0 ${boxW} ${boxH}`}
        style={{ width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
        aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <path
              d={clipPath?.d ?? borderPath.d}
              transform={`scale(${clipPath?.scaleX ?? 1} ${clipPath?.scaleY ?? 1})`}
              clipRule={clipPath?.fillRule ?? 'nonzero'}
            />
          </clipPath>
        </defs>
        {media.url && rect ? (
          <image
            href={media.url}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            preserveAspectRatio="none"
            clipPath={`url(#${clipId})`}
            onError={() => setFailed(element.src)}
          />
        ) : null}
        {stroke && strokeWidth > 0 ? (
          <path
            d={borderPath.d}
            transform={`scale(${borderPath.scaleX} ${borderPath.scaleY})`}
            fill="none"
            fillRule={borderPath.fillRule}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dasharray}
          />
        ) : null}
      </svg>
    </div>
  )
}
