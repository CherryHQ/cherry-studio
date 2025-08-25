import { ImagePreviewService } from '@renderer/services/ImagePreviewService'
import { makeSvgSizeAdaptive } from '@renderer/utils/image'
import { Dropdown } from 'antd'
import { Eye } from 'lucide-react'
import React, { FC, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface SvgProps extends React.SVGProps<SVGSVGElement> {
  'data-needs-measurement'?: 'true'
}

/**
 * A smart SVG renderer for Markdown content.
 *
 * This component handles two types of SVGs passed from `react-markdown`:
 *
 * 1.  **Pre-processed SVGs**: Simple SVGs that were already handled by the
 *     `rehypeScalableSvg` plugin. These are rendered directly.
 *
 * 2.  **SVGs needing measurement**: Complex SVGs are flagged with
 *     `data-needs-measurement`. This component performs a one-time DOM
 *     mutation upon mounting to make them scalable. To prevent React from
 *     reverting these changes during subsequent renders, it stops passing
 *     the original `width` and `height` props after the mutation is complete.
 */
const MarkdownSvgRenderer: FC<SvgProps> = (props) => {
  const { 'data-needs-measurement': needsMeasurement, ...restProps } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const isMeasuredRef = useRef(false)
  const { t } = useTranslation()

  useEffect(() => {
    if (needsMeasurement && svgRef.current && !isMeasuredRef.current) {
      // Directly mutate the DOM element to make it adaptive.
      makeSvgSizeAdaptive(svgRef.current)
      // Set flag to prevent re-measuring. This does not trigger a re-render.
      isMeasuredRef.current = true
    }
  }, [needsMeasurement])

  const onPreview = useCallback(() => {
    if (!svgRef.current) return
    ImagePreviewService.show(svgRef.current, { format: 'svg' })
  }, [])

  const contextMenuItems = useMemo(
    () => [
      {
        key: 'preview',
        label: t('common.preview'),
        icon: <Eye size="1rem" />,
        onClick: onPreview
      }
    ],
    [onPreview, t]
  )

  // Create a mutable copy of props to potentially modify.
  const finalProps = { ...restProps }

  // If the SVG has been measured and mutated, we prevent React from
  // re-applying the original width and height attributes on subsequent renders.
  // This preserves the changes made by `makeSvgSizeAdaptive`.
  if (isMeasuredRef.current) {
    delete finalProps.width
    delete finalProps.height
  }

  return (
    <Dropdown menu={{ items: contextMenuItems }} trigger={['contextMenu']}>
      <svg ref={svgRef} {...finalProps} />
    </Dropdown>
  )
}

export default MarkdownSvgRenderer
