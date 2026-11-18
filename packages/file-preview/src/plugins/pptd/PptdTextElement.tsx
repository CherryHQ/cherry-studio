import { useMemo } from 'react'

import type { PptdText } from './pptdFormat'
import { pptdTextAlignCss, pptdTextStyleCss, renderPptdRichText, resolvePptdTextStyle } from './pptdRichText'
import { pptdColorToCss, pptdFillToCss, type PptdStyleContext } from './pptdStyle'

interface PptdTextElementProps {
  element: PptdText
  context: PptdStyleContext
}

/** Text element: resolved style chain + rich text + layout per the upstream reference. */
export function PptdTextElement({ element, context }: PptdTextElementProps) {
  const { content } = element
  const style = resolvePptdTextStyle(content, context)
  const css = pptdTextStyleCss(style, context)
  const vertical = content.textDirection === 'vertical'
  const align = content.align ?? ['left', 'top']

  const body = useMemo(() => renderPptdRichText(content.text, { context, align: content.align }), [content, context])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: align[1] === 'middle' ? 'center' : align[1] === 'bottom' ? 'flex-end' : 'flex-start',
        overflow: content.wrap === false ? 'visible' : 'hidden',
        ...css,
        ...pptdTextAlignCss(content.align),
        ...(content.wrap === false ? { whiteSpace: 'nowrap' } : {}),
        ...(vertical ? { writingMode: 'vertical-rl' } : {}),
        ...(content.gradient
          ? {
              ...pptdFillToCss({ type: 'gradient', ...content.gradient }, context),
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent'
            }
          : {}),
        ...(content.shadow
          ? {
              textShadow: `${content.shadow.offset?.[0] ?? 0}px ${content.shadow.offset?.[1] ?? 0}px ${content.shadow.blur}px ${pptdColorToCss(content.shadow.color, context) ?? '#000000'}`
            }
          : {})
      }}>
      {body}
    </div>
  )
}
