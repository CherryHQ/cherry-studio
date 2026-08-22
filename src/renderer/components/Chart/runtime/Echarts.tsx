import { cn } from '@renderer/utils/style'
import { AriaComponent } from 'echarts/components'
import type { EChartsCoreOption, EChartsType, SetOptionOpts } from 'echarts/core'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

echarts.use([AriaComponent, CanvasRenderer])

interface EchartsProps {
  ariaLabel: string
  className?: string
  loading: boolean | undefined
  loadingColor: string
  loadingLabel: string | undefined
  loadingTextColor: string
  option: EChartsCoreOption
}

export function Echarts({
  ariaLabel,
  className,
  loading = false,
  loadingColor,
  loadingLabel,
  loadingTextColor,
  option
}: EchartsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<EChartsType | null>(null)
  const appliedOptionRef = useRef<{ option: EChartsCoreOption; settings: SetOptionOpts } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const instance = echarts.init(container, undefined, { renderer: 'canvas' })
    instanceRef.current = instance
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
