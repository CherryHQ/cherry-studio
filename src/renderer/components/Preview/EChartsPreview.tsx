import { useTheme } from '@renderer/hooks/useTheme'
import type { EChartsCoreOption } from 'echarts'
import * as echarts from 'echarts'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ImagePreviewLayout from './ImagePreviewLayout'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'

const EChartsPreview = ({
  children,
  enableToolbar = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const { theme } = useTheme()
  const { t } = useTranslation()

  useEffect(() => {
    let chart: ReturnType<typeof echarts.init> | null = null
    let resizeObserver: ResizeObserver | null = null
    let handleWindowResize: (() => void) | null = null
    let parsedOption: EChartsCoreOption | undefined

    try {
      parsedOption = JSON.parse(children) as EChartsCoreOption
    } catch {
      setError(t('code_block.preview.invalid_json'))
      return
    }

    try {
      if (!containerRef.current) {
        return
      }

      const chartTheme = theme === 'dark' ? 'dark' : undefined
      chart = echarts.init(containerRef.current, chartTheme, { renderer: 'svg' })
      chart.setOption(parsedOption)
      setError(null)

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => chart?.resize())
        resizeObserver.observe(containerRef.current)
      }

      handleWindowResize = () => chart?.resize()
      window.addEventListener('resize', handleWindowResize)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    }

    return () => {
      if (handleWindowResize) {
        window.removeEventListener('resize', handleWindowResize)
      }
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
      chart?.dispose()
    }
  }, [children, theme, t])

  return (
    <ImagePreviewLayout error={error} enableToolbar={enableToolbar} ref={ref} imageRef={containerRef} source="echarts">
      <div ref={containerRef} className="echarts special-preview h-64 w-full" />
    </ImagePreviewLayout>
  )
}

export default memo(EChartsPreview)
