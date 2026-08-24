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
  isStreaming = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const wasStreamingRef = useRef(isStreaming)

  const renderChart = useCallback(
    async (content: string, container: HTMLDivElement) => {
      if (!content) {
        return
      }

      // While the source is still streaming, never surface temporary parse errors
      // or commit a partially-generated option. The caller will trigger an immediate
      // render once streaming completes.
      if (isStreaming) {
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
    [isStreaming, t, theme]
  )

  const { containerRef, error, isLoading, triggerImmediateRender } = useDebouncedRender(children, renderChart, {
    debounceDelay: 300
  })

  // Render the exact final option immediately when streaming completes. After that,
  // ordinary children changes continue to be debounced by useDebouncedRender.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      triggerImmediateRender(children)
    }
    wasStreamingRef.current = isStreaming
  }, [children, isStreaming, triggerImmediateRender])

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
      loading={isLoading || isStreaming}
      error={error}
      enableToolbar={enableToolbar}
      // ECharts owns interactions inside the chart; generic image pan/zoom would break its coordinate model.
      enableDrag={false}
      enableWheelZoom={false}
      ref={ref}
      imageRef={containerRef}
      source="echarts">
      <div ref={containerRef} className="echarts special-preview h-64 w-full" />
    </ImagePreviewLayout>
  )
}

export default memo(EChartsPreview)
