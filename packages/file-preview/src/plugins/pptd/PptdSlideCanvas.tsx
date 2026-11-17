import { useTranslation } from 'react-i18next'

import type { PptdPresentation } from './pptdFormat'
import type { PptdProjectFileReader, PptdProjectPage } from './pptdProject'
import { pptdFillToCss, type PptdStyleContext } from './pptdStyle'

interface PptdSlideCanvasProps {
  presentation: PptdPresentation
  page: PptdProjectPage
  zoom: number
  readProjectFile?: PptdProjectFileReader
}

/**
 * Renders one PPTD page as a fixed-size canvas at the presentation `size`,
 * scaled by the preview zoom. Element renderers land layer by layer; until an
 * element type has a renderer it shows a visible placeholder naming the
 * element, per the spec's "nothing is silently dropped" rule.
 */
export function PptdSlideCanvas({ presentation, page, zoom }: PptdSlideCanvasProps) {
  const { t } = useTranslation()
  const [width, height] = presentation.size
  const scale = zoom / 100
  const context: PptdStyleContext = { theme: presentation.theme }

  return (
    <div
      data-testid="pptd-slide-canvas"
      style={{
        width: width * scale,
        height: height * scale,
        flexShrink: 0
      }}>
      <div
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          ...(page.status === 'ok' ? (pptdFillToCss(page.page.background, context) ?? { background: '#FFFFFF' }) : {})
        }}>
        {page.status !== 'ok' && (
          <div
            role="alert"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#FFFFFF',
              color: '#B45309',
              fontSize: 14,
              padding: 24,
              textAlign: 'center'
            }}>
            {t('file_preview.pptd.page_unavailable', { path: page.path, reason: page.reason })}
          </div>
        )}
        {page.status === 'ok' &&
          page.elements.map((element, index) => (
            <div
              key={`${element.elementId}-${index}`}
              data-element-id={element.elementId}
              data-element-type={element.elementType}
              style={{
                position: 'absolute',
                left: element.bounds?.[0] ?? 0,
                top: element.bounds?.[1] ?? 0,
                width: element.bounds?.[2] ?? width / 4,
                height: element.bounds?.[3] ?? 40,
                border: '1px dashed #B45309',
                color: '#B45309',
                fontSize: 11,
                overflow: 'hidden'
              }}>
              {element.elementType === 'invalid'
                ? t('file_preview.pptd.unsupported_element', { id: element.elementId, type: element.declaredType })
                : `${element.elementType}: ${element.elementId}`}
            </div>
          ))}
      </div>
    </div>
  )
}
