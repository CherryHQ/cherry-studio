import { useVirtualizer } from '@tanstack/react-virtual'
import { debounce } from 'es-toolkit/compat'
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThemedToken } from 'shiki/core'

import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCodeHighlight } from '@renderer/hooks/useCodeHighlight'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { codeViewerSelectionManager } from '@renderer/services/CodeViewerSelectionManager'
import { getReactStyleFromToken } from '@renderer/utils/shiki'
import { cn } from '@renderer/utils/style'
import { uuid } from '@renderer/utils/uuid'

import {
  type CodeViewerSavedSelection as SavedSelection,
  mergeCodeViewerSelection,
  resolveCodeViewerBoundary
} from './codeViewerSelection'

const logger = loggerService.withContext('CodeViewer')

interface CodeViewerProps {
  /** Code string value. */
  value: string
  /**
   * Code language string.
   * - Case-insensitive.
   * - Supports common names: javascript, json, python, etc.
   * - Supports shiki aliases: c#/csharp, objective-c++/obj-c++/objc++, etc.
   */
  language: string
  onHeightChange?: (scrollHeight: number) => void
  /**
   * Height of the scroll container.
   * Only works when expanded is false.
   */
  height?: string | number
  /**
   * Maximum height of the scroll container.
   * Only works when expanded is false.
   */
  maxHeight?: string | number
  /** Viewer options. */
  options?: {
    /**
     * Whether to show line numbers.
     */
    lineNumbers?: boolean
    /**
     * Whether to syntax highlight visible code.
     */
    highlight?: boolean
  }
  /** Font size that overrides the app setting. */
  fontSize?: number
  /** CSS class name appended to the default `code-viewer` class. */
  className?: string
  /**
   * Whether the editor is expanded.
   * If true, the height and maxHeight props are ignored.
   * @default true
   */
  expanded?: boolean
  /**
   * Whether the code lines are wrapped.
   * @default true
   */
  wrapped?: boolean
  /**
   * Callback to request expansion when multi-line selection is detected.
   */
  onRequestExpand?: () => void
  /**
   * Keep the internal viewer scroller pinned to the bottom while content grows.
   */
  autoScrollToBottom?: boolean
}

/**
 * Shiki 流式代码高亮组件
 * - 通过 shiki tokenizer 处理流式响应，高性能
 * - 使用虚拟滚动和按需高亮，改善页面内有大量长代码块时的响应
 * - 并发安全
 */
const CodeViewer = ({
  value,
  language,
  height,
  maxHeight,
  onHeightChange,
  options,
  fontSize: customFontSize,
  className,
  expanded = true,
  wrapped = true,
  onRequestExpand,
  autoScrollToBottom = false
}: CodeViewerProps) => {
  const [_lineNumbers] = usePreference('chat.code.show_line_numbers')
  const [_fontSize] = usePreference('chat.message.font_size')
  const { getShikiPreProperties, isShikiThemeDark } = useCodeStyle()
  const shikiThemeRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const callerId = useRef(`${Date.now()}-${uuid()}`).current
  const savedSelectionRef = useRef<SavedSelection | null>(null)
  const pointerReplaceRef = useRef(false)
  const keyboardReplaceRef = useRef(false)
  const lastPointerTypeRef = useRef<string | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const wasHighlightEnabledRef = useRef(options?.highlight ?? true)
  const hasRequestedHighlightRef = useRef(false)
  // Ensure the active selection actually belongs to this CodeViewer instance
  const selectionBelongsToViewer = useCallback((sel: Selection | null) => {
    const scroller = scrollerRef.current
    if (!scroller || !sel || sel.rangeCount === 0) return false

    // Check if selection intersects with scroller
    const range = sel.getRangeAt(0)
    return scroller.contains(range.commonAncestorContainer)
  }, [])

  const fontSize = useMemo(() => customFontSize ?? _fontSize - 1, [customFontSize, _fontSize])
  const lineNumbers = useMemo(() => options?.lineNumbers ?? _lineNumbers, [options?.lineNumbers, _lineNumbers])
  const highlight = options?.highlight ?? true

  const rawLines = useMemo(() => (typeof value === 'string' ? value.trimEnd().split('\n') : []), [value])

  useEffect(() => {
    if (!autoScrollToBottom || expanded) {
      shouldStickToBottomRef.current = true
    }
  }, [autoScrollToBottom, expanded])

  // 计算行号数字位数
  const gutterDigits = useMemo(
    () => (lineNumbers ? Math.max(rawLines.length.toString().length, 1) : 0),
    [lineNumbers, rawLines.length]
  )

  // 设置 pre 标签属性
  useLayoutEffect(() => {
    let mounted = true
    const shikiTheme = shikiThemeRef.current
    if (shikiTheme) {
      shikiTheme.className = `code-viewer ${className ?? ''}`
      shikiTheme.classList.add(isShikiThemeDark ? 'shiki-dark' : 'shiki-light')
    }

    if (!highlight) return

    void getShikiPreProperties(language).then((properties) => {
      if (!mounted) return
      const shikiTheme = shikiThemeRef.current
      if (shikiTheme) {
        shikiTheme.className = `${properties.class || 'shiki'} code-viewer ${className ?? ''}`
        // 滚动条适应 shiki 主题变化而非应用主题
        shikiTheme.classList.add(isShikiThemeDark ? 'shiki-dark' : 'shiki-light')

        if (properties.style) {
          shikiTheme.style.cssText += `${properties.style}`
        }
        // FIXME: 临时解决 SelectionToolbar 无法弹出，走剪贴板回退的问题
        // shikiTheme.tabIndex = properties.tabindex
      }
    })
    return () => {
      mounted = false
    }
  }, [language, getShikiPreProperties, isShikiThemeDark, className, highlight])

  // 保存当前选区的逻辑位置
  const saveSelection = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null
    }

    // Only capture selections within this viewer's scroller
    if (!selectionBelongsToViewer(selection)) {
      return null
    }

    const range = selection.getRangeAt(0)
    const scroller = scrollerRef.current
    if (!scroller) return null

    const start = resolveCodeViewerBoundary(scroller, range.startContainer, range.startOffset, 'start')
    const end = resolveCodeViewerBoundary(scroller, range.endContainer, range.endOffset, 'end')

    if (!start || !end) {
      logger.warn('saveSelection failed', {
        hasStart: !!start,
        hasEnd: !!end
      })
      return null
    }

    logger.debug('saveSelection success', {
      startLine: start.line,
      startOffset: start.offset,
      endLine: end.line,
      endOffset: end.offset
    })

    return { start, end }
  }, [selectionBelongsToViewer])

  const commitSelection = useCallback((): SavedSelection | null => {
    const allowReplace = pointerReplaceRef.current || keyboardReplaceRef.current
    keyboardReplaceRef.current = false
    const parsed = saveSelection()
    if (!parsed) return null
    const { start, end } = parsed
    const previous = savedSelectionRef.current
    const saved = mergeCodeViewerSelection(previous, start, end, allowReplace)
    savedSelectionRef.current = saved
    return saved
  }, [saveSelection])

  // 滚动事件处理：保存选择用于复制，但不恢复（避免选择高亮问题）
  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller && autoScrollToBottom && !expanded) {
      const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      shouldStickToBottomRef.current = distanceToBottom <= 8
    }

    // 只保存选择状态用于复制，不在滚动时恢复选择
    const saved = commitSelection()
    if (saved) {
      logger.debug('Selection saved for copy', {
        startLine: saved.startLine,
        endLine: saved.endLine
      })
    }
  }, [autoScrollToBottom, expanded, commitSelection])

  // 处理复制事件，确保跨虚拟滚动的复制能获取完整内容
  const handleCopy = useCallback(
    (event: ClipboardEvent) => {
      const selection = window.getSelection()
      // Ignore copies for selections outside this viewer
      if (!selectionBelongsToViewer(selection)) {
        return
      }
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return
      }

      const saved = commitSelection() ?? savedSelectionRef.current

      if (!saved) {
        logger.warn('Cannot get selection, using browser default')
        return
      }

      const { startLine, startOffset, endLine, endOffset } = saved

      // Always use custom copy in collapsed state to handle virtual scroll edge cases
      const needsCustomCopy = !expanded

      logger.debug('Copy event', {
        startLine,
        endLine,
        startOffset,
        endOffset,
        expanded,
        needsCustomCopy,
        usedSavedSelection: !!savedSelectionRef.current
      })

      if (needsCustomCopy) {
        try {
          const selectedLines: string[] = []

          for (let i = startLine; i <= endLine; i++) {
            const line = rawLines[i] || ''

            if (i === startLine && i === endLine) {
              // 单行选择
              selectedLines.push(line.slice(startOffset, endOffset))
            } else if (i === startLine) {
              // 第一行，从 startOffset 到行尾
              selectedLines.push(line.slice(startOffset))
            } else if (i === endLine) {
              // 最后一行，从行首到 endOffset
              selectedLines.push(line.slice(0, endOffset))
            } else {
              // 中间的完整行
              selectedLines.push(line)
            }
          }

          const fullText = selectedLines.join('\n')

          logger.debug('Custom copy success', {
            linesCount: selectedLines.length,
            totalLength: fullText.length,
            firstLine: selectedLines[0]?.slice(0, 30),
            lastLine: selectedLines[selectedLines.length - 1]?.slice(0, 30)
          })

          if (!event.clipboardData) {
            logger.warn('clipboardData unavailable, using browser default copy')
            return
          }
          event.clipboardData.setData('text/plain', fullText)
          event.preventDefault()
        } catch (error) {
          logger.error('Custom copy failed', { error })
        }
      }
    },
    [selectionBelongsToViewer, expanded, commitSelection, rawLines]
  )

  // Virtualizer 配置
  const getScrollElement = useCallback(() => scrollerRef.current, [])
  const getItemKey = useCallback((index: number) => `${callerId}-${index}`, [callerId])
  // `line-height: 1.6` 为全局样式，但是为了避免测量误差在这里取整
  const lineHeight = useMemo(() => Math.round(fontSize * 1.6), [fontSize])

  const getWrapContentWidth = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || scroller.clientWidth <= 0) return 0
    const gutterPx = lineNumbers ? gutterDigits * fontSize * 0.6 + 16 : 0
    const horizontalPadding = fontSize * 2
    return Math.max(1, scroller.clientWidth - gutterPx - horizontalPadding)
  }, [fontSize, gutterDigits, lineNumbers])

  const estimateWrappedVisualRows = useCallback(
    (line: string, contentWidth: number) => {
      if (!wrapped || contentWidth <= 0) return 1
      if (line.length === 0) return 1
      const charWidth = fontSize * 0.6
      const charsPerRow = Math.max(1, Math.floor(contentWidth / charWidth))
      return Math.max(1, Math.ceil(line.length / charsPerRow))
    },
    [fontSize, wrapped]
  )

  const estimateSize = useCallback(
    (index: number) => {
      const contentWidth = getWrapContentWidth()
      const visualRows = estimateWrappedVisualRows(rawLines[index] ?? '', contentWidth)
      return lineHeight * visualRows
    },
    [estimateWrappedVisualRows, getWrapContentWidth, lineHeight, rawLines]
  )

  // 创建 virtualizer 实例
  const virtualizer = useVirtualizer({
    count: rawLines.length,
    getScrollElement,
    getItemKey,
    estimateSize,
    overscan: 20
  })

  const previousRawLinesRef = useRef<string[] | null>(null)

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    let lastWidth = scroller.clientWidth
    const observer = new ResizeObserver(() => {
      const nextWidth = scroller.clientWidth
      if (nextWidth === lastWidth) return
      lastWidth = nextWidth
      if (wrapped && !expanded) {
        virtualizer.measure()
      }
    })
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [expanded, virtualizer, wrapped])

  const previousWrapLayoutSignatureRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!wrapped || expanded) return
    const signature = `${lineNumbers}:${gutterDigits}:${fontSize}`
    if (previousWrapLayoutSignatureRef.current === signature) return
    previousWrapLayoutSignatureRef.current = signature
    virtualizer.measure()
  }, [expanded, fontSize, gutterDigits, lineNumbers, virtualizer, wrapped])

  useLayoutEffect(() => {
    if (!wrapped || expanded) {
      previousRawLinesRef.current = rawLines
      return
    }

    const previous = previousRawLinesRef.current
    previousRawLinesRef.current = rawLines
    if (!previous) return

    const scroller = scrollerRef.current
    const maxIndex = Math.max(previous.length, rawLines.length) - 1
    for (let index = 0; index <= maxIndex; index++) {
      if (previous[index] === rawLines[index]) continue
      // Feed the virtualizer the row's real DOM height: writing an estimate would
      // overwrite its measured size and drift every subsequent row's offset.
      // Unmounted rows are skipped — they use fresh estimates until measured on mount.
      const element = scroller?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      if (element) {
        virtualizer.resizeItem(index, element.offsetHeight)
      }
    }
  }, [expanded, rawLines, virtualizer, wrapped])

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  // 使用代码高亮 Hook
  const { tokenLines, highlightLines, resetHighlight } = useCodeHighlight({
    rawLines,
    language,
    callerId
  })

  // 防抖高亮提高流式响应的性能，数字大一点也不会影响用户体验
  const debouncedHighlightLines = useMemo(() => debounce(highlightLines, 300), [highlightLines])

  useEffect(() => {
    if (highlight) {
      wasHighlightEnabledRef.current = true
      return
    }

    debouncedHighlightLines.cancel()
    if (wasHighlightEnabledRef.current) {
      resetHighlight()
      wasHighlightEnabledRef.current = false
      hasRequestedHighlightRef.current = false
    }
  }, [debouncedHighlightLines, highlight, resetHighlight])

  useEffect(() => {
    return () => {
      debouncedHighlightLines.cancel()
    }
  }, [debouncedHighlightLines])

  // 首帧仅让视口内代码块绕过防抖，避免可见文本闪烁和离屏 Worker 请求突发。
  useEffect(() => {
    if (!highlight) return
    const shikiTheme = shikiThemeRef.current
    if (virtualItems.length === 0 || !shikiTheme) return

    const lastIndex = virtualItems[virtualItems.length - 1].index
    if (!hasRequestedHighlightRef.current) {
      hasRequestedHighlightRef.current = true
      const rect = shikiTheme.getBoundingClientRect()
      const intersectsViewport =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth

      if (!intersectsViewport) {
        void debouncedHighlightLines(lastIndex + 1)
        return
      }
      void highlightLines(lastIndex + 1)
      return
    }

    void debouncedHighlightLines(lastIndex + 1)
  }, [virtualItems, debouncedHighlightLines, highlightLines, highlight])

  // Monitor selection changes, clear stale selection state, and auto-expand in collapsed state
  const handleSelectionChange = useCallback(
    (selection: Selection | null) => {
      if (!selection || !selectionBelongsToViewer(selection)) {
        savedSelectionRef.current = null
        return
      }

      // In collapsed state, detect multi-line selection and request expand
      if (!expanded && onRequestExpand) {
        const saved = saveSelection()
        if (saved && saved.end.line > saved.start.line) {
          logger.debug('Multi-line selection detected in collapsed state, requesting expand', {
            startLine: saved.start.line,
            endLine: saved.end.line
          })
          onRequestExpand()
        }
      }
    },
    [expanded, onRequestExpand, saveSelection, selectionBelongsToViewer]
  )
  const selectionChangeHandlerRef = useRef(handleSelectionChange)

  useLayoutEffect(() => {
    selectionChangeHandlerRef.current = handleSelectionChange
  }, [handleSelectionChange])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    return codeViewerSelectionManager.register(scroller, (selection) => selectionChangeHandlerRef.current(selection))
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const document = scroller.ownerDocument
    const cleanup = () => {
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', cancel)
    }
    const finish = () => {
      cleanup()
      commitSelection()
      pointerReplaceRef.current = false
    }
    const cancel = finish
    const startSelection = () => {
      savedSelectionRef.current = null
      pointerReplaceRef.current = true
    }
    const dblclick = () => {
      startSelection()
      finish()
    }
    const contextmenu = () => {
      if (lastPointerTypeRef.current === 'touch') {
        startSelection()
        finish()
      }
    }
    const keydown = (event: KeyboardEvent) => {
      if (!selectionBelongsToViewer(window.getSelection())) return
      if (
        event.key.startsWith('Arrow') ||
        event.key === 'Home' ||
        event.key === 'End' ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a')
      ) {
        keyboardReplaceRef.current = true
      }
    }
    const keyup = () => {
      if (!selectionBelongsToViewer(window.getSelection())) return
      if (keyboardReplaceRef.current) commitSelection()
    }
    const begin = (event: PointerEvent) => {
      lastPointerTypeRef.current = event.pointerType
      if (event.button !== 0) return
      // Scrollbar gestures do not start a text selection.
      const rect = scroller.getBoundingClientRect()
      if (event.clientX >= rect.left + scroller.clientWidth || event.clientY >= rect.top + scroller.clientHeight) return
      cleanup()
      if (event.pointerType !== 'touch') startSelection()
      document.addEventListener('pointerup', finish, { once: true })
      document.addEventListener('pointercancel', cancel, { once: true })
    }
    scroller.addEventListener('pointerdown', begin)
    scroller.addEventListener('contextmenu', contextmenu)
    scroller.addEventListener('dblclick', dblclick)
    document.addEventListener('keydown', keydown)
    document.addEventListener('keyup', keyup)
    return () => {
      cleanup()
      scroller.removeEventListener('pointerdown', begin)
      scroller.removeEventListener('contextmenu', contextmenu)
      scroller.removeEventListener('dblclick', dblclick)
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('keyup', keyup)
    }
  }, [commitSelection, selectionBelongsToViewer])

  // Listen for copy events
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    scroller.addEventListener('copy', handleCopy as EventListener)
    return () => {
      scroller.removeEventListener('copy', handleCopy as EventListener)
    }
  }, [handleCopy])

  // Report scrollHeight when it might change
  useLayoutEffect(() => {
    onHeightChange?.(scrollerRef.current?.scrollHeight ?? 0)
  }, [rawLines.length, onHeightChange])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !autoScrollToBottom || expanded || !shouldStickToBottomRef.current) return

    scroller.scrollTop = scroller.scrollHeight
  }, [autoScrollToBottom, expanded, rawLines.length, totalSize])

  return (
    <div ref={shikiThemeRef} style={expanded ? undefined : { height }}>
      <div
        ref={scrollerRef}
        className="shiki-scroller relative block overflow-x-auto rounded-[inherit] py-[0.5em] pr-0 pl-[1em] [scrollbar-color:auto]"
        onScroll={handleScroll}
        style={
          {
            '--gutter-width': `${gutterDigits}ch`,
            '--line-height': `${lineHeight}px`,
            fontSize,
            height: expanded ? undefined : height,
            maxHeight: expanded ? undefined : maxHeight,
            overflowY: expanded ? 'hidden' : 'auto'
          } as React.CSSProperties
        }>
        <div
          className="shiki-list"
          style={{
            height: `${totalSize}px`,
            width: '100%',
            position: 'relative'
          }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItems[0]?.start ?? 0}px)`
            }}>
            {virtualItems.map((virtualItem) => (
              <div key={virtualItem.key} data-index={virtualItem.index} ref={virtualizer.measureElement}>
                <VirtualizedRow
                  rawLine={rawLines[virtualItem.index]}
                  tokenLine={highlight ? tokenLines[virtualItem.index] : undefined}
                  highlightEnabled={highlight}
                  showLineNumbers={lineNumbers}
                  expanded={expanded}
                  wrapped={wrapped}
                  index={virtualItem.index}
                  isDarkTheme={isShikiThemeDark}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

CodeViewer.displayName = 'CodeViewer'

// 渐进式高亮时，尚未被 shiki 覆盖到的内容用淡化样式提示“高亮即将到来”
const dimmedTokenStyle = {
  color: 'inherit',
  bgColor: 'inherit',
  htmlStyle: {
    opacity: '0.35'
  }
}

// 关闭高亮（streaming）时，直接以正常不透明度渲染原始文本
const plainTokenStyle = {
  color: 'inherit',
  bgColor: 'inherit',
  htmlStyle: {
    opacity: '1'
  }
}

interface VirtualizedRowData {
  rawLine: string
  tokenLine?: ThemedToken[]
  highlightEnabled: boolean
  showLineNumbers: boolean
  expanded: boolean
  wrapped: boolean
  isDarkTheme: boolean
}

/**
 * 单行代码渲染
 */
const VirtualizedRow = memo(
  ({
    rawLine,
    tokenLine,
    highlightEnabled,
    showLineNumbers,
    expanded,
    wrapped,
    index,
    isDarkTheme
  }: VirtualizedRowData & { index: number }) => {
    // 补全代码行 tokens，把原始内容拼接到高亮内容之后，确保渲染出整行来。
    const completeTokenLine = useMemo(() => {
      // 关闭高亮时按原始文本渲染，不淡化；开启高亮时用淡化样式提示尚未覆盖到的内容
      const fallbackTokenStyle = highlightEnabled ? dimmedTokenStyle : plainTokenStyle

      // 如果出现空行，补一个空元素保证行高
      if (rawLine.length === 0) {
        return [
          {
            content: '',
            offset: 0,
            ...fallbackTokenStyle
          }
        ]
      }

      const currentTokens = tokenLine ?? []
      const themedContentLength = currentTokens.reduce((acc, token) => acc + token.content.length, 0)

      // 已有内容已经全部高亮，直接返回
      if (themedContentLength >= rawLine.length) {
        return currentTokens
      }

      // 补全剩余内容
      return [
        ...currentTokens,
        {
          content: rawLine.slice(themedContentLength),
          offset: themedContentLength,
          ...fallbackTokenStyle
        }
      ]
    }, [rawLine, tokenLine, highlightEnabled])

    return (
      <div
        className="line flex w-full items-start leading-[var(--line-height)]"
        style={{
          contain: wrapped ? 'content' : 'none',
          willChange: !wrapped && !expanded ? 'transform' : 'auto'
        }}>
        {showLineNumbers && (
          <span
            className="line-number mr-4 shrink-0 select-none overflow-hidden text-right font-[inherit] tabular-nums opacity-[0.35]"
            style={{ width: 'var(--gutter-width, 1.2ch)' }}>
            {index + 1}
          </span>
        )}
        <span
          className={cn(
            // min-w-0 lets the flex item shrink below its min-content width so long
            // unbreakable lines (base64, URLs, minified JSON) wrap instead of overflowing.
            // The !important on the wrapped whitespace beats global markdown CSS
            // (`.markdown pre span { white-space: pre }`) that would otherwise pin
            // token spans to `pre` and defeat wrapping inside chat code blocks.
            'line-content min-w-0 flex-1 whitespace-pre pr-[1em]',
            wrapped ? '[&_*]:whitespace-pre-wrap! [&_*]:break-words!' : '[&_*]:whitespace-pre [&_*]:break-normal'
          )}>
          {completeTokenLine.map((token, tokenIndex) => (
            <span key={tokenIndex} style={getReactStyleFromToken(token, { isDarkTheme })}>
              {token.content}
            </span>
          ))}
        </span>
      </div>
    )
  }
)

VirtualizedRow.displayName = 'VirtualizedRow'

export default memo(CodeViewer)
