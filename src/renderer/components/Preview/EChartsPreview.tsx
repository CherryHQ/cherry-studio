import { loggerService } from '@logger'
import { useTheme } from '@renderer/hooks/useTheme'
import type { EChartsCoreOption } from 'echarts'
import * as echarts from 'echarts'
import { memo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'

const logger = loggerService.withContext('EChartsPreview')

const EChartsPreview = ({
  children,
  enableToolbar = false,
  isStreaming = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const optionRef = useRef<EChartsCoreOption | null>(null)
  const wasStreamingRef = useRef(isStreaming)

  const renderChartOption = useCallback(
    (container: HTMLDivElement, option: EChartsCoreOption) => {
      if (!chartRef.current) {
        chartRef.current = echarts.init(container, theme === 'dark' ? 'dark' : undefined, { renderer: 'svg' })
      }

      chartRef.current.setOption(option, true)
    },
    [theme]
  )

  const renderChart = useCallback(
    async (content: string, container: HTMLDivElement) => {
      if (!content) {
        optionRef.current = null
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
        optionRef.current = null
        throw new Error(t('code_block.preview.invalid_json'))
      }

      optionRef.current = option

      const { width, height } = container.getBoundingClientRect()
      if (!chartRef.current && (width === 0 || height === 0)) {
        return
      }

      renderChartOption(container, option)
    },
    [isStreaming, t, renderChartOption]
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

  // Resize the chart when the container size changes.
  // because ECharts does not automatically detect container size changes.
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const initChartIfReady = (width: number, height: number) => {
      if (width === 0 || height === 0) {
        return
      }

      const option = optionRef.current
      if (!option || chartRef.current) {
        return
      }

      try {
        renderChartOption(container, option)
      } catch (error) {
        logger.error(
          'Failed to initialize chart on container resize',
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }

    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      const { width, height } = container.getBoundingClientRect()
      initChartIfReady(width, height)

      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) {
          return
        }

        const { width, height } = entry.contentRect
        if (width === 0 || height === 0) {
          return
        }

        if (!chartRef.current) {
          initChartIfReady(width, height)
        } else {
          // Resize the chart when the container size changes.
          // because ECharts does not automatically detect container size changes.
          chartRef.current.resize()
        }
      })

      resizeObserver.observe(container)
    }

    return () => {
      resizeObserver?.disconnect()
    }
  }, [containerRef, renderChartOption])

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
