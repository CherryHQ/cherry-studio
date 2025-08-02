import { loggerService } from '@logger'
import { debounce } from 'lodash'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const logger = loggerService.withContext('useDebouncedRender')

/**
 * 预览渲染器选项
 */
export interface DebouncedRenderOptions {
  /** 防抖延迟时间，默认 300ms */
  debounceDelay?: number
  /** 渲染前的额外条件检查 */
  shouldRender?: () => boolean
}

/**
 * 预览渲染器返回值
 */
export interface DebouncedRenderResult {
  /** 容器元素引用 */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 错误状态 */
  error: string | null
  /** 加载状态 */
  isLoading: boolean
  /** 手动触发渲染 */
  triggerRender: (content: string) => void
  /** 取消渲染 */
  cancelRender: () => void
  /** 清除错误状态 */
  clearError: () => void
  /** 手动设置加载状态 */
  setLoading: (loading: boolean) => void
}

/**
 * 图像预览防抖渲染器 Hook
 *
 * - 容器 ref 管理
 * - value 变化监听
 * - 防抖渲染
 * - 错误处理
 * - 加载状态管理
 *
 * @param value 要渲染的内容
 * @param renderFunction 实际的渲染函数，接收内容和容器元素
 * @param options 配置选项
 * @returns 渲染器状态、容器引用和控制函数
 */
export const useDebouncedRender = (
  value: string,
  renderFunction: (content: string, container: HTMLDivElement) => Promise<void>,
  options: DebouncedRenderOptions = {}
): DebouncedRenderResult => {
  const { debounceDelay = 300, shouldRender } = options

  const containerRef = useRef<HTMLDivElement>(null)
  const debouncedFunctionRef = useRef<ReturnType<typeof debounce> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // 包装渲染函数，添加容器检查和错误处理
  const wrappedRenderFunction = useCallback(
    async (content: string): Promise<void> => {
      // 检查渲染前条件
      if ((shouldRender && !shouldRender()) || !content) {
        return
      }

      if (!containerRef.current) {
        logger.warn('Container element not available')
        throw new Error('Container element not available')
      }

      try {
        setIsLoading(true)

        await renderFunction(content, containerRef.current)

        // 渲染成功，确保清除错误状态
        setError(null)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown rendering error'
        logger.error(errorMessage)
        setError(errorMessage)
      } finally {
        setIsLoading(false)
      }
    },
    [renderFunction, shouldRender]
  )

  // 创建防抖版本的渲染函数
  const debouncedRender = useMemo(() => {
    const debouncedFn = debounce((content: string) => {
      React.startTransition(() => {
        wrappedRenderFunction(content)
      })
    }, debounceDelay)

    // 存储引用用于后续取消
    debouncedFunctionRef.current = debouncedFn

    return debouncedFn
  }, [wrappedRenderFunction, debounceDelay])

  // 手动触发渲染的函数
  const triggerRender = useCallback(
    (content: string) => {
      if (content) {
        setIsLoading(true)
        debouncedRender(content)
      } else {
        debouncedRender.cancel()
        setIsLoading(false)
        setError(null)
      }
    },
    [debouncedRender]
  )

  const cancelRender = useCallback(() => {
    debouncedRender.cancel()
    setIsLoading(false)
  }, [debouncedRender])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // 手动设置加载状态
  const setLoadingState = useCallback((loading: boolean) => {
    setIsLoading(loading)
  }, [])

  // 监听 children 变化，自动触发渲染
  useEffect(() => {
    if (value) {
      triggerRender(value)
    } else {
      cancelRender()
    }

    return () => {
      cancelRender()
    }
  }, [value, triggerRender, cancelRender])

  useEffect(() => {
    return () => {
      if (debouncedFunctionRef.current) {
        debouncedFunctionRef.current.cancel()
      }
    }
  }, [])

  return {
    containerRef,
    error,
    isLoading,
    triggerRender,
    cancelRender,
    clearError,
    setLoading: setLoadingState
  }
}
