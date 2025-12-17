import type { TextAreaRef } from 'antd/es/input/TextArea'
import { useCallback, useRef, useState } from 'react'

export interface UseTextareaResizeOptions {
  maxHeight?: number
  minHeight?: number
  autoResize?: boolean
}

export interface UseTextareaResizeReturn {
  textareaRef: React.RefObject<TextAreaRef | null>
  resize: (force?: boolean) => void
  focus: () => void
  customHeight: number | undefined
  setCustomHeight: (height: number | undefined) => void
  setExpanded: (expanded: boolean, expandedHeight?: number) => void
  isExpanded: boolean
}

/**
 * 管理 Textarea 自动调整大小的通用 Hook
 *
 * 支持自动调整高度、手动展开/收起、自定义高度限制
 *
 * @param options - 配置选项
 * @param options.maxHeight - 最大高度限制（默认 400px）
 * @param options.minHeight - 最小高度限制（默认 30px）
 * @param options.autoResize - 是否自动调整大小（默认 true）
 * @returns Textarea ref 和调整方法
 *
 * @example
 * ```tsx
 * const { textareaRef, resize, setExpanded, isExpanded, customHeight } = useTextareaResize({
 *   maxHeight: 400,
 *   minHeight: 30
 * })
 *
 * useEffect(() => {
 *   resize() // 在内容变化后调用
 * }, [text])
 *
 * <TextArea
 *   ref={textareaRef}
 *   style={{ height: customHeight }}
 *   autoSize={customHeight ? false : { minRows: 2, maxRows: 20 }}
 * />
 * <button onClick={() => setExpanded(!isExpanded)}>Toggle Expand</button>
 * ```
 */
export function useTextareaResize(options: UseTextareaResizeOptions = {}): UseTextareaResizeReturn {
  const { maxHeight = 400, minHeight = 30, autoResize = true } = options

  const textareaRef = useRef<TextAreaRef>(null)
  const [customHeight, setCustomHeight] = useState<number | undefined>(undefined)
  const [isExpanded, setIsExpanded] = useState(false)

  const resize = useCallback(
    (force = false) => {
      if (!autoResize && !force) {
        return
      }

      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (!textArea) {
        return
      }

      // 如果设置了自定义高度且不是强制调整，则跳过
      if (customHeight !== undefined && !force) {
        return
      }

      textArea.style.height = 'auto'
      if (textArea.scrollHeight) {
        const newHeight = Math.max(minHeight, Math.min(textArea.scrollHeight, maxHeight))
        textArea.style.height = `${newHeight}px`
      }
    },
    [autoResize, customHeight, maxHeight, minHeight]
  )

  const focus = useCallback(() => {
    textareaRef.current?.focus()
  }, [])

  const setExpanded = useCallback(
    (expanded: boolean, expandedHeight = 0.7 * window.innerHeight) => {
      const textArea = textareaRef.current?.resizableTextArea?.textArea
      if (!textArea) {
        setIsExpanded(expanded)
        setCustomHeight(expanded ? expandedHeight : undefined)
        return
      }

      if (expanded) {
        const viewportHeight = window.innerHeight || expandedHeight
        const desiredHeight = Math.max(minHeight, Math.min(expandedHeight, viewportHeight * 0.9))
        textArea.style.height = `${desiredHeight}px`
        setCustomHeight(desiredHeight)
        setIsExpanded(true)
      } else {
        textArea.style.height = 'auto'
        setCustomHeight(undefined)
        setIsExpanded(false)
        // 收起后重新计算高度
        requestAnimationFrame(() => {
          const contentHeight = textArea.scrollHeight
          const nextHeight = Math.max(minHeight, Math.min(contentHeight, maxHeight))
          textArea.style.height = `${nextHeight}px`
        })
      }
    },
    [maxHeight, minHeight]
  )

  return {
    textareaRef,
    resize,
    focus,
    customHeight,
    setCustomHeight,
    setExpanded,
    isExpanded
  }
}
