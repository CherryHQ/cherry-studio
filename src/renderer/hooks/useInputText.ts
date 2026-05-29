import { useCallback, useRef, useState } from 'react'

export interface UseInputTextOptions {
  initialValue?: string
  onChange?: (text: string) => void
}

export interface UseInputTextReturn {
  text: string
  setText: (text: string | ((prev: string) => string)) => void
  prevText: string
  isEmpty: boolean
  clear: () => void
}

/**
 * 管理文本输入状态的通用 Hook
 *
 * 提供文本状态管理、历史追踪和便捷方法
 *
 * @param options - 配置选项
 * @param options.initialValue - 初始文本值
 * @param options.onChange - 文本变化回调
 * @returns 文本状态和操作方法
 *
 * @example
 * ```tsx
 * const { text, setText, isEmpty, clear } = useInputText({
 *   initialValue: '',
 *   onChange: (text) => console.log('Text changed:', text)
 * })
 *
 * <input value={text} onChange={(e) => setText(e.target.value)} />
 * <button disabled={isEmpty}>Send</button>
 * <button onClick={clear}>Clear</button>
 * ```
 */
export function useInputText(options: UseInputTextOptions = {}): UseInputTextReturn {
  const [text, setText] = useState(options.initialValue ?? '')
  const prevTextRef = useRef(text)

  const handleSetText = useCallback(
    (value: string | ((prev: string) => string)) => {
      const newText = typeof value === 'function' ? value(text) : value
      prevTextRef.current = text
      setText(newText)
      options.onChange?.(newText)
    },
    [text, options]
  )

  const clear = useCallback(() => {
    handleSetText('')
  }, [handleSetText])

  return {
    text,
    setText: handleSetText,
    prevText: prevTextRef.current,
    isEmpty: text.trim().length === 0,
    clear
  }
}
