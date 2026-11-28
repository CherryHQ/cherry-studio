import { AriaComponent } from 'echarts/components'
import type { EChartsCoreOption, EChartsType, SetOptionOpts } from 'echarts/core'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

import { cn } from '@renderer/utils/style'

import type { ChartClickParams } from '../types'

echarts.use([AriaComponent, CanvasRenderer])

interface EchartsProps {
  ariaLabel: string
  className?: string
  loading: boolean | undefined
  loadingColor: string
  loadingLabel: string | undefined
  loadingTextColor: string
  onClick?: (params: ChartClickParams) => void
  onTimelineChange?: (currentIndex: number) => void
  option: EChartsCoreOption
  timelineIndex?: number
}

export function Echarts({
  ariaLabel,
  className,
  loading = false,
  loadingColor,
  loadingLabel,
  loadingTextColor,
  onClick,
  onTimelineChange,
  option,
  timelineIndex
}: EchartsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<EChartsType | null>(null)
  const appliedOptionRef = useRef<{ option: EChartsCoreOption; settings: SetOptionOpts } | null>(null)
  const onClickRef = useRef(onClick)
  onClickRef.current = onClick
  const onTimelineChangeRef = useRef(onTimelineChange)
  onTimelineChangeRef.current = onTimelineChange
  const timelineIndexRef = useRef(timelineIndex)
  timelineIndexRef.current = timelineIndex

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const instance = echarts.init(container, undefined, { renderer: 'canvas' })
    instanceRef.current = instance
    const handleClick = (params: {
      componentType?: string
      seriesIndex?: number
      seriesId?: string
      dataIndex?: number
      name?: string
    }) => {
      if (params.componentType !== 'series' || typeof params.dataIndex !== 'number') return
      onClickRef.current?.({
        seriesIndex: params.seriesIndex,
        seriesId: params.seriesId,
        dataIndex: params.dataIndex,
        name: params.name,
        timelineIndex: timelineIndexRef.current
      })
    }
    const handleTimelineChanged = (params: unknown) => {
      if (
        typeof params === 'object' &&
        params !== null &&
        'currentIndex' in params &&
        typeof params.currentIndex === 'number'
      ) {
        timelineIndexRef.current = params.currentIndex
        onTimelineChangeRef.current?.(params.currentIndex)
      }
    }
    instance.on?.('click', handleClick)
    instance.on?.('timelinechanged', handleTimelineChanged)
    let hasSized = container.clientWidth > 0 && container.clientHeight > 0
    const resizeObserver = new ResizeObserver(() => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      if (!hasSized && appliedOptionRef.current) {
        instance.setOption(appliedOptionRef.current.option, appliedOptionRef.current.settings)
      }
      hasSized = true
      instance.resize()
    })
    resizeObserver.observe(container)

    return () => {
      instance.off?.('click', handleClick)
      instance.off?.('timelinechanged', handleTimelineChanged)
      resizeObserver.disconnect()
      instance.dispose()
      instanceRef.current = null
    }
  }, [])

  useEffect(() => {
    if (loading) return

    const aria = { enabled: true, label: { description: ariaLabel } }
    const nextOption: EChartsCoreOption = option.baseOption
      ? { ...option, baseOption: { ...option.baseOption, aria } }
      : { ...option, aria }
    const hasTimeline = option.baseOption !== undefined
    const settings: SetOptionOpts = {
      lazyUpdate: true,
      replaceMerge: hasTimeline
        ? ['series', 'dataZoom', 'grid', 'xAxis', 'yAxis']
        : ['series', 'dataZoom', 'timeline', 'grid', 'xAxis', 'yAxis', 'legend']
    }
    appliedOptionRef.current = { option: nextOption, settings }
    instanceRef.current?.setOption(nextOption, settings)
  }, [ariaLabel, loading, option])

  useEffect(() => {
    if (loading) {
      instanceRef.current?.showLoading('default', {
        color: loadingColor,
        text: loadingLabel ?? '',
        textColor: loadingTextColor,
        maskColor: 'transparent'
      })
    } else {
      instanceRef.current?.hideLoading()
    }
  }, [loading, loadingColor, loadingLabel, loadingTextColor])

  return (
    <div
      ref={containerRef}
      role="img"
      aria-busy={loading}
      aria-label={ariaLabel}
      className={cn('h-64 w-full min-w-0', className)}
    />
  )
}
