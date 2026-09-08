import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { ImagePreviewService } from '@renderer/services/ImagePreviewService'
import { makeSvgSizeAdaptive } from '@renderer/utils/image'
import { Eye } from 'lucide-react'
import { type FC, type SVGProps, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExtraProps } from 'streamdown'

interface SvgProps extends SVGProps<SVGSVGElement>, ExtraProps {
  'data-needs-measurement'?: 'true'
}

const MarkdownSvgRenderer: FC<SvgProps> = (props) => {
  const { 'data-needs-measurement': needsMeasurement, node, ...restProps } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const measuredSourceRef = useRef<string | null>(null)
  const { t } = useTranslation()
  const sourceKey = useMemo(() => `${needsMeasurement ?? ''}:${JSON.stringify(node) ?? ''}`, [needsMeasurement, node])
  const isMeasured = measuredSourceRef.current === sourceKey

  useEffect(() => {
    if (needsMeasurement && svgRef.current && measuredSourceRef.current !== sourceKey) {
      makeSvgSizeAdaptive(svgRef.current)
      measuredSourceRef.current = sourceKey
    }
  }, [needsMeasurement, sourceKey])

  const onPreview = useCallback(() => {
    if (!svgRef.current) return
    void ImagePreviewService.show(svgRef.current, { format: 'svg' })
  }, [])

  const finalProps = { ...restProps }
  if (isMeasured) {
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
      <svg key={sourceKey} ref={svgRef} {...finalProps} />
    </CommandContextMenu>
  )
}

export default MarkdownSvgRenderer
