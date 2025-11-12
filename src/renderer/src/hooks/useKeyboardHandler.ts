import { useCallback, useRef } from 'react'

export interface KeyboardHandlerCallbacks {
  onSend?: () => void
  onEscape?: () => void
  onTab?: () => void
  onCustom?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
}

export interface KeyboardHandlerOptions {
  sendShortcut?: 'Enter' | 'Ctrl+Enter' | 'Cmd+Enter' | 'Shift+Enter'
  enableTabNavigation?: boolean
  enableEscape?: boolean
}

/**
 * 通用键盘事件处理 Hook
 *
 * 提供常见的键盘快捷键处理（发送、取消、Tab 导航等）
 *
 * @param callbacks - 键盘事件回调函数
 * @param callbacks.onSend - 发送消息回调（根据 sendShortcut 触发）
 * @param callbacks.onEscape - Escape 键回调
 * @param callbacks.onTab - Tab 键回调
 * @param callbacks.onCustom - 自定义键盘处理回调
 * @param options - 配置选项
 * @param options.sendShortcut - 发送快捷键类型（默认 'Enter'）
 * @param options.enableTabNavigation - 是否启用 Tab 导航（默认 false）
 * @param options.enableEscape - 是否启用 Escape 键处理（默认 false）
 * @returns 键盘事件处理函数
 *
 * @example
 * ```tsx
 * const handleKeyDown = useKeyboardHandler(
 *   {
 *     onSend: () => sendMessage(),
 *     onEscape: () => closeModal(),
 *     onTab: () => navigateToNextField()
 *   },
 *   {
 *     sendShortcut: 'Ctrl+Enter',
 *     enableTabNavigation: true,
 *     enableEscape: true
 *   }
 * )
 *
 * <textarea onKeyDown={handleKeyDown} />
 * ```
 */
export function useKeyboardHandler(callbacks: KeyboardHandlerCallbacks, options: KeyboardHandlerOptions = {}) {
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const { sendShortcut = 'Enter', enableTabNavigation = false, enableEscape = false } = options

      // Tab 导航
      if (enableTabNavigation && event.key === 'Tab') {
        event.preventDefault()
        callbacksRef.current.onTab?.()
        return
      }

      // Escape 键
      if (enableEscape && event.key === 'Escape') {
        event.stopPropagation()
        callbacksRef.current.onEscape?.()
        return
      }

      // Enter 键处理
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
        const isSendPressed =
          (sendShortcut === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) ||
          (sendShortcut === 'Ctrl+Enter' && event.ctrlKey) ||
          (sendShortcut === 'Cmd+Enter' && event.metaKey) ||
          (sendShortcut === 'Shift+Enter' && event.shiftKey)

        if (isSendPressed) {
          event.preventDefault()
          callbacksRef.current.onSend?.()
          return
        }
      }

      // 自定义处理器
      callbacksRef.current.onCustom?.(event)
    },
    [options]
  )

  return handleKeyDown
}
