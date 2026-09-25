import { nanoid } from 'nanoid'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'

import { useMermaid } from '@renderer/hooks/useMermaid'

import { useDebouncedRender } from './hooks/useDebouncedRender'
import ImagePreviewLayout from './ImagePreviewLayout'
import { ShadowTransparentContainer } from './styles'
import type { BasicPreviewHandles, BasicPreviewProps } from './types'
import { renderSvgInShadowHost } from './utils'

type MermaidRenderJob = {
  run?: (isCancelled: () => boolean) => Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
  started: boolean
  cancelled: boolean
}

class MermaidRenderQueue {
  private pending: MermaidRenderJob[] = []
  private running = false

  enqueue(run: (isCancelled: () => boolean) => Promise<void>) {
    let job!: MermaidRenderJob
    const promise = new Promise<void>((resolve, reject) => {
      job = { run, resolve, reject, started: false, cancelled: false }
    })
    this.pending.push(job)
    this.startNext()

    return {
      promise,
      isQueued: () => !job.started && !job.cancelled,
      cancel: () => {
        if (job.cancelled) return
        job.cancelled = true
        if (!job.started) {
          this.pending.splice(this.pending.indexOf(job), 1)
          job.run = undefined
          job.resolve()
        }
      }
    }
  }

  private startNext() {
    if (this.running) return
    const job = this.pending.shift()
    if (!job) return

    this.running = true
    job.started = true
    const run = job.run!
    job.run = undefined
    void run(() => job.cancelled)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.running = false
        this.startNext()
      })
  }
}

const mermaidRenderQueue = new MermaidRenderQueue()
type MermaidRenderInvocation = ReturnType<MermaidRenderQueue['enqueue']>

/**
 * 预览 Mermaid 图表
 * - 使用 useDebouncedRender 改善体验
 * - 使用 shadow dom 渲染 SVG
 */
const MermaidPreview = ({
  children,
  enableToolbar = false,
  ref
}: BasicPreviewProps & { ref?: React.RefObject<BasicPreviewHandles | null> }) => {
  const { mermaid, isLoading: isLoadingMermaid, error: mermaidError, forceRenderKey } = useMermaid()
  const diagramId = useRef<string>(`mermaid-${nanoid(6)}`).current
  const [isVisible, setIsVisible] = useState(true)
  const [previewBackgroundColor, setPreviewBackgroundColor] = useState<string>()
  const invocations = useRef(new Set<MermaidRenderInvocation>())

  useEffect(
    () => () => {
      for (const invocation of invocations.current) invocation.cancel()
      invocations.current.clear()
    },
    []
  )

  /**
   * 定义渲染函数，在临时容器中测量，在 shadow dom 中渲染。
   * 如果这个方案有问题，可以回退到 innerHTML。
   */
  const renderMermaid = useCallback(
    (content: string, container: HTMLDivElement) => {
      for (const invocation of invocations.current) {
        if (invocation.isQueued()) invocation.cancel()
      }

      const invocation = mermaidRenderQueue.enqueue(async (isCancelled) => {
        try {
          if (isCancelled()) return
          // 验证语法，提前抛出异常
          await mermaid.parse(content)
          if (isCancelled()) return
          const renderBackgroundColor = mermaid.mermaidAPI.getConfig().themeVariables?.background

          // 获取容器宽度
          const { width } = container.getBoundingClientRect()
          if (width === 0) return

          // 创建临时的 div 用于 mermaid 测量
          const measureEl = document.createElement('div')
          measureEl.style.position = 'absolute'
          measureEl.style.left = '-9999px'
          measureEl.style.top = '-9999px'
          measureEl.style.width = `${width}px`
          document.body.appendChild(measureEl)

          try {
            const { svg } = await mermaid.render(diagramId, content, measureEl)
            if (isCancelled()) return

            // 避免不可见时产生 undefined 和 NaN
            const fixedSvg = svg.replace(/translate\(undefined,\s*NaN\)/g, 'translate(0, 0)')

            // 有问题可以回退到 innerHTML
            renderSvgInShadowHost(fixedSvg, container)
            setPreviewBackgroundColor(renderBackgroundColor)
            // container.innerHTML = fixedSvg
          } finally {
            document.body.removeChild(measureEl)
          }
        } catch (error) {
          if (!isCancelled()) throw error
        }
      })
      invocations.current.add(invocation)
      void invocation.promise.then(
        () => invocations.current.delete(invocation),
        () => invocations.current.delete(invocation)
      )
      return invocation.promise
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diagramId, mermaid, forceRenderKey]
  )

  // 可见性检测函数
  const shouldRender = useCallback(() => {
    return !isLoadingMermaid && isVisible
  }, [isLoadingMermaid, isVisible])

  // 使用预览渲染器 hook
  const {
    containerRef,
    error: renderError,
    isLoading: isRendering
  } = useDebouncedRender(children, renderMermaid, {
    debounceDelay: 300,
    shouldRender
  })

  /**
   * 监听可见性变化，用于触发重新渲染。
   * 这是为了解决 `MessageGroup` 组件的 `fold` 布局中被 `display: none` 隐藏的图标无法正确渲染的问题。
   * 监听时向上遍历到第一个有 `fold` className 的父节点为止（也就是目前的 `MessageWrapper`）。
   * FIXME: 将来 mermaid-js 修复此问题后可以移除这里的相关逻辑。
   */
  useEffect(() => {
    if (!containerRef.current) return

    const checkVisibility = () => {
      const element = containerRef.current
      if (!element) return

      const currentlyVisible = element.offsetParent !== null && element.offsetWidth > 0 && element.offsetHeight > 0
      setIsVisible(currentlyVisible)
    }

    // 初始检查
    checkVisibility()

    const observer = new MutationObserver(() => {
      checkVisibility()
    })

    let targetElement = containerRef.current.parentElement
    while (targetElement) {
      observer.observe(targetElement, {
        attributes: true,
        attributeFilter: ['class', 'style']
      })

      if (targetElement.className?.includes('fold')) {
        break
      }

      targetElement = targetElement.parentElement
    }

    return () => {
      observer.disconnect()
    }
  }, [containerRef])

  // 合并加载状态和错误状态
  const isLoading = isLoadingMermaid || isRendering
  const error = mermaidError || renderError

  return (
    <ImagePreviewLayout
      loading={isLoading}
      error={error}
      enableToolbar={enableToolbar}
      ref={ref}
      imageRef={containerRef}
      previewBackgroundColor={previewBackgroundColor}
      source="mermaid">
      <ShadowTransparentContainer
        ref={containerRef}
        className="mermaid special-preview flex items-center justify-center"
      />
    </ImagePreviewLayout>
  )
}

export default memo(MermaidPreview)
