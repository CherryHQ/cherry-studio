import { useTheme } from '@renderer/hooks/useTheme'
import type { EChartsCoreOption } from 'echarts'
import * as echarts from 'echarts'
import { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'

const EChartsPreview = ({
  children,
  enableToolbar = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)

  const renderChart = useCallback(
    async (content: string, container: HTMLDivElement) => {
      if (!content) {
        return
      }

      let option: EChartsCoreOption
      try {
        option = JSON.parse(content) as EChartsCoreOption
      } catch {
        throw new Error(t('code_block.preview.invalid_json'))
      }

      if (!chartRef.current) {
        chartRef.current = echarts.init(container, theme === 'dark' ? 'dark' : undefined, { renderer: 'svg' })
      }

      chartRef.current.setOption(option, true)
    },
    [t, theme]
  )

  const { containerRef, error, isLoading } = useDebouncedRender(children, renderChart, { debounceDelay: 300 })

  useEffect(() => {
    return () => {
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [theme])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => chartRef.current?.resize())
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      resizeObserver?.disconnect()
    }
  }, [containerRef])

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      source="echarts">
      <div ref={containerRef} className="echarts special-preview h-64 w-full" />
    </ImagePreviewLayout>
  )
}

export default memo(EChartsPreview)
