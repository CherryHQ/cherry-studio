import { AriaComponent, type TimelineComponentOption } from 'echarts/components'
import type { EChartsCoreOption, EChartsType, SetOptionOpts } from 'echarts/core'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useCallback, useEffect, useRef } from 'react'

import { ImageCaptureEvent } from '@renderer/utils/image'
import { cn } from '@renderer/utils/style'

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
  const captureRef = useRef({ version: 0, readyVersion: -1, loading: false })
  const pendingCapturesRef = useRef(new Set<(error: Error) => void>())
  const invalidateCapture = useCallback(() => {
    captureRef.current.version++
    captureRef.current.readyVersion = -1
    for (const reject of pendingCapturesRef.current) reject(new Error('Chart changed during image capture'))
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const instance = echarts.init(container, undefined, { renderer: 'canvas' })
    instanceRef.current = instance
    const onFinished = () => {
      if (!captureRef.current.loading && container.clientWidth > 0 && container.clientHeight > 0) {
        captureRef.current.readyVersion = captureRef.current.version
      }
    }
    instance.on('finished', onFinished)
    instance.on('timelinechanged', invalidateCapture)
    instance.on('datazoom', invalidateCapture)
    const prepareCapture = (event: Event) => {
      if (!(event instanceof ImageCaptureEvent)) return
      event.preparations.push(
        new Promise<() => void>((resolve, reject) => {
          const state = captureRef.current
          const version = state.version
          const cleanup = () => {
            clearTimeout(timer)
            instance.off('finished', checkReady)
            pendingCapturesRef.current.delete(fail)
          }
          const fail = (error: Error) => {
            cleanup()
            reject(error)
          }
          const checkReady = () => {
            if (instance.isDisposed() || instanceRef.current !== instance) {
              fail(new Error('Chart is unavailable for image capture'))
            } else if (
              !state.loading &&
              state.version === version &&
              state.readyVersion === version &&
              container.clientWidth > 0 &&
              container.clientHeight > 0
            ) {
              cleanup()
              resolve(cleanup)
            }
          }
          const timer = setTimeout(() => fail(new Error('Timed out waiting for chart image capture')), 3000)
          pendingCapturesRef.current.add(fail)
          instance.on('finished', checkReady)
          checkReady()
        })
      )
    }
    container.addEventListener(ImageCaptureEvent.type, prepareCapture)
    let hasSized = container.clientWidth > 0 && container.clientHeight > 0
    const resizeObserver = new ResizeObserver(() => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return
      invalidateCapture()
      if (!hasSized && appliedOptionRef.current) {
        instance.setOption(appliedOptionRef.current.option, appliedOptionRef.current.settings)
      }
      hasSized = true
      instance.resize()
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      container.removeEventListener(ImageCaptureEvent.type, prepareCapture)
      invalidateCapture()
      instance.off('finished', onFinished)
      instance.off('timelinechanged', invalidateCapture)
      instance.off('datazoom', invalidateCapture)
      instance.dispose()
      instanceRef.current = null
    }
  }, [invalidateCapture])

  useEffect(() => {
    captureRef.current.loading = loading
    invalidateCapture()
    if (loading) return

    const instance = instanceRef.current
    if (!instance) return

    const aria = { enabled: true, label: { description: ariaLabel } }
    const nextOption: EChartsCoreOption = option.baseOption
      ? { ...option, baseOption: { ...option.baseOption, aria } }
      : { ...option, aria }
    const liveTimeline = (instance.getOption()?.timeline as TimelineComponentOption[] | undefined)?.[0]
    const liveIndex = liveTimeline?.currentIndex
    const nextBaseOption = nextOption.baseOption ?? nextOption
    const nextTimeline = nextBaseOption.timeline as TimelineComponentOption | TimelineComponentOption[] | undefined
    if (typeof liveIndex === 'number' && Number.isInteger(liveIndex) && nextTimeline && !Array.isArray(nextTimeline)) {
      const frameCount = nextTimeline.data?.length
      const currentIndex =
        frameCount !== undefined && frameCount !== liveTimeline?.data?.length
          ? Math.max(0, Math.min(liveIndex, frameCount - 1))
          : liveIndex
      const timeline: TimelineComponentOption = { ...nextTimeline, currentIndex }
      nextBaseOption.timeline = timeline
    }
    const hasTimeline = option.baseOption !== undefined
    const settings: SetOptionOpts = {
      lazyUpdate: true,
      replaceMerge: hasTimeline
        ? ['series', 'dataZoom', 'grid', 'xAxis', 'yAxis']
        : ['series', 'dataZoom', 'timeline', 'grid', 'xAxis', 'yAxis', 'legend']
    }
    appliedOptionRef.current = { option: nextOption, settings }
    instance.setOption(nextOption, settings)
  }, [ariaLabel, invalidateCapture, loading, option])

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
      data-image-capture-content
      role="img"
      aria-busy={loading}
      aria-label={ariaLabel}
      className={cn('h-64 w-full min-w-0', className)}
    />
  )
}
