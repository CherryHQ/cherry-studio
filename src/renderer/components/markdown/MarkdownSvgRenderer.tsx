import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { ImagePreviewService } from '@renderer/services/ImagePreviewService'
import { makeSvgSizeAdaptive } from '@renderer/utils/image'
import { Eye } from 'lucide-react'
import { type FC, type SVGProps, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface SvgProps extends SVGProps<SVGSVGElement> {
  'data-needs-measurement'?: 'true'
}

const MarkdownSvgRenderer: FC<SvgProps> = (props) => {
  const { 'data-needs-measurement': needsMeasurement, ...restProps } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const isMeasuredRef = useRef(false)
  const { t } = useTranslation()

  useEffect(() => {
    if (needsMeasurement && svgRef.current && !isMeasuredRef.current) {
      makeSvgSizeAdaptive(svgRef.current)
      isMeasuredRef.current = true
    }
  }, [needsMeasurement])

  const onPreview = useCallback(() => {
    if (!svgRef.current) return
    void ImagePreviewService.show(svgRef.current, { format: 'svg' })
  }, [])

  const finalProps = { ...restProps }
  if (isMeasuredRef.current) {
    delete finalProps.width
    delete finalProps.height
  }

  const items = useMemo<CommandContextMenuExtraItem[]>(
    () => [
      { type: 'item', id: 'svg.preview', label: t('common.preview'), icon: <Eye size="1rem" />, onSelect: onPreview }
    ],
    [onPreview, t]
  )

  return (
    <CommandContextMenu location="webcontents.context" extraItems={items}>
      <svg ref={svgRef} {...finalProps} />
    </CommandContextMenu>
  )
}

export default MarkdownSvgRenderer
