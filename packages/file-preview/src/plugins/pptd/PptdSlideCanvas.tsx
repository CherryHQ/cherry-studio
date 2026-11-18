import { useTranslation } from 'react-i18next'

import type { PptdPageElement, PptdPresentation } from './pptdFormat'
import { PptdIconElement } from './PptdIconElement'
import { PptdImageElement } from './PptdImageElement'
import { PptdLineElement } from './PptdLineElement'
import type { PptdProjectFileReader, PptdProjectPage } from './pptdProject'
import { PptdShapeElement } from './PptdShapeElement'
import { pptdFillToCss, type PptdStyleContext } from './pptdStyle'
import { PptdTableElement } from './PptdTableElement'
import { PptdTextElement } from './PptdTextElement'

function elementTransform(element: PptdPageElement): string | undefined {
  if (element.elementType === 'invalid') return undefined
  const parts: string[] = []
  if (element.rotation) parts.push(`rotate(${element.rotation}deg)`)
  if (element.flip?.[0]) parts.push('scaleX(-1)')
  if (element.flip?.[1]) parts.push('scaleY(-1)')
  return parts.length > 0 ? parts.join(' ') : undefined
}

function PptdElementBody({
  element,
  context,
  readProjectFile
}: {
  element: PptdPageElement
  context: PptdStyleContext
  readProjectFile?: PptdProjectFileReader
}) {
  const { t } = useTranslation()
  if (element.elementType === 'text') {
    return <PptdTextElement element={element} context={context} />
  }
  if (element.elementType === 'shape') {
    return <PptdShapeElement element={element} context={context} />
  }
  if (element.elementType === 'line') {
    return <PptdLineElement element={element} context={context} />
  }
  if (element.elementType === 'image') {
    return <PptdImageElement element={element} context={context} readProjectFile={readProjectFile} />
  }
  if (element.elementType === 'icon') {
    return <PptdIconElement element={element} context={context} />
  }
  if (element.elementType === 'table') {
    return <PptdTableElement element={element} context={context} />
  }
  if (element.elementType === 'invalid') {
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
        {t('file_preview.pptd.unsupported_element', { id: element.elementId, type: element.declaredType })}
      </div>
    )
  }
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
      {t('file_preview.pptd.unsupported_element', { id: element.elementId, type: element.elementType })}
    </div>
  )
}

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
export function PptdSlideCanvas({ presentation, page, zoom, readProjectFile }: PptdSlideCanvasProps) {
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
                transform: elementTransform(element),
                opacity: element.elementType !== 'invalid' ? element.opacity : undefined
              }}>
              <PptdElementBody element={element} context={context} readProjectFile={readProjectFile} />
            </div>
          ))}
      </div>
    </div>
  )
}
