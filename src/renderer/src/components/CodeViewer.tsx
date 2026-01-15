import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useCodeHighlight } from '@renderer/hooks/useCodeHighlight'
import { uuid } from '@renderer/utils'
import { getReactStyleFromToken } from '@renderer/utils/shiki'
import { useVirtualizer } from '@tanstack/react-virtual'
import { debounce } from 'lodash'
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThemedToken } from 'shiki/core'
import styled from 'styled-components'

const logger = loggerService.withContext('CodeViewer')

interface SavedSelection {
  startLine: number
  startOffset: number
  endLine: number
  endOffset: number
}

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
  onRequestExpand
}: CodeViewerProps) => {
  const [_lineNumbers] = usePreference('chat.code.show_line_numbers')
  const [_fontSize] = usePreference('chat.message.font_size')
  const { getShikiPreProperties, isShikiThemeDark } = useCodeStyle()
  const shikiThemeRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const callerId = useRef(`${Date.now()}-${uuid()}`).current
  const savedSelectionRef = useRef<SavedSelection | null>(null)
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

  const rawLines = useMemo(() => (typeof value === 'string' ? value.trimEnd().split('\n') : []), [value])

  // 计算行号数字位数
  const gutterDigits = useMemo(
    () => (lineNumbers ? Math.max(rawLines.length.toString().length, 1) : 0),
    [lineNumbers, rawLines.length]
  )

  // 设置 pre 标签属性
  useLayoutEffect(() => {
    let mounted = true
    getShikiPreProperties(language).then((properties) => {
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
  }, [language, getShikiPreProperties, isShikiThemeDark, className])

  // 保存当前选区的逻辑位置
  const saveSelection = useCallback((): SavedSelection | null => {
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

    // 查找选区起始和结束位置对应的行号
    const findLineAndOffset = (node: Node, offset: number): { line: number; offset: number } | null => {
      // 向上查找包含 data-index 属性的元素
      let element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement

      // 跳过行号元素，找到实际的行内容
      while (element) {
        if (element.classList?.contains('line-number')) {
          // 如果在行号上，移动到同级的 line-content
          const lineContainer = element.parentElement
          const lineContent = lineContainer?.querySelector('.line-content')
          if (lineContent) {
            element = lineContent as Element
            break
          }
        }
        if (element.hasAttribute('data-index')) {
          break
        }
        element = element.parentElement
      }

      if (!element || !element.hasAttribute('data-index')) {
        logger.warn('Could not find data-index element', {
          nodeName: node.nodeName,
          nodeType: node.nodeType
        })
        return null
      }

      const lineIndex = parseInt(element.getAttribute('data-index') || '0', 10)
      const lineContent = element.querySelector('.line-content') || element

      // Calculate character offset within the line
      let charOffset = 0
      if (node.nodeType === Node.TEXT_NODE) {
        // 遍历该行的所有文本节点，找到当前节点的位置
        const walker = document.createTreeWalker(lineContent as Node, NodeFilter.SHOW_TEXT)
        let currentNode: Node | null
        while ((currentNode = walker.nextNode())) {
          if (currentNode === node) {
            charOffset += offset
            break
          }
          charOffset += currentNode.textContent?.length || 0
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // 如果是元素节点，计算之前所有文本的长度
        const textBefore = (node as Element).textContent?.slice(0, offset) || ''
        charOffset = textBefore.length
      }

      logger.debug('findLineAndOffset result', {
        lineIndex,
        charOffset
      })

      return { line: lineIndex, offset: charOffset }
    }

    const start = findLineAndOffset(range.startContainer, range.startOffset)
    const end = findLineAndOffset(range.endContainer, range.endOffset)

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

    return {
      startLine: start.line,
      startOffset: start.offset,
      endLine: end.line,
      endOffset: end.offset
    }
  }, [selectionBelongsToViewer])

  // 滚动事件处理：保存选择用于复制，但不恢复（避免选择高亮问题）
  const handleScroll = useCallback(() => {
    // 只保存选择状态用于复制，不在滚动时恢复选择
    const saved = saveSelection()
    if (saved) {
      savedSelectionRef.current = saved
      logger.debug('Selection saved for copy', {
        startLine: saved.startLine,
        endLine: saved.endLine
      })
    }
  }, [saveSelection])

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

      // Prefer saved selection from scroll, otherwise get it in real-time
      let saved = savedSelectionRef.current
      if (!saved) {
        saved = saveSelection()
      }

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
    [selectionBelongsToViewer, expanded, saveSelection, rawLines]
  )

  // Virtualizer 配置
  const getScrollElement = useCallback(() => scrollerRef.current, [])
  const getItemKey = useCallback((index: number) => `${callerId}-${index}`, [callerId])
  // `line-height: 1.6` 为全局样式，但是为了避免测量误差在这里取整
  const estimateSize = useCallback(() => Math.round(fontSize * 1.6), [fontSize])

  // 创建 virtualizer 实例
  const virtualizer = useVirtualizer({
    count: rawLines.length,
    getScrollElement,
    getItemKey,
    estimateSize,
    overscan: 20
  })

  const virtualItems = virtualizer.getVirtualItems()

  // 使用代码高亮 Hook
  const { tokenLines, highlightLines } = useCodeHighlight({
    rawLines,
    language,
    callerId
  })

  // 防抖高亮提高流式响应的性能，数字大一点也不会影响用户体验
  const debouncedHighlightLines = useMemo(() => debounce(highlightLines, 300), [highlightLines])

  // 渐进式高亮
  useEffect(() => {
    if (virtualItems.length > 0 && shikiThemeRef.current) {
      const lastIndex = virtualItems[virtualItems.length - 1].index
      debouncedHighlightLines(lastIndex + 1)
    }
  }, [virtualItems, debouncedHighlightLines])

  // Monitor selection changes, clear stale selection state, and auto-expand in collapsed state
  const handleSelectionChange = useMemo(
    () =>
      debounce(() => {
        const selection = window.getSelection()

        // No valid selection: clear and return
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
          savedSelectionRef.current = null
          return
        }

        // Only handle selections within this CodeViewer
        if (!selectionBelongsToViewer(selection)) {
          savedSelectionRef.current = null
          return
        }

        // In collapsed state, detect multi-line selection and request expand
        if (!expanded && onRequestExpand) {
          const saved = saveSelection()
          if (saved && saved.endLine > saved.startLine) {
            logger.debug('Multi-line selection detected in collapsed state, requesting expand', {
              startLine: saved.startLine,
              endLine: saved.endLine
            })
            onRequestExpand()
          }
        }
      }, 100),
    [expanded, onRequestExpand, saveSelection, selectionBelongsToViewer]
  )

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      handleSelectionChange.cancel()
    }
  }, [handleSelectionChange])

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

  return (
    <div ref={shikiThemeRef} style={expanded ? undefined : { height }}>
      <ScrollContainer
        ref={scrollerRef}
        className="shiki-scroller"
        $wrap={wrapped}
        $expand={expanded}
        $lineHeight={estimateSize()}
        onScroll={handleScroll}
        style={
          {
            '--gutter-width': `${gutterDigits}ch`,
            fontSize,
            height: expanded ? undefined : height,
            maxHeight: expanded ? undefined : maxHeight,
            overflowY: expanded ? 'hidden' : 'auto'
          } as React.CSSProperties
        }>
        <div
          className="shiki-list"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
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
                  tokenLine={tokenLines[virtualItem.index]}
                  showLineNumbers={lineNumbers}
                  index={virtualItem.index}
                />
              </div>
            ))}
          </div>
        </div>
      </ScrollContainer>
    </div>
  )
}

CodeViewer.displayName = 'CodeViewer'

const plainTokenStyle = {
  color: 'inherit',
  bgColor: 'inherit',
  htmlStyle: {
    opacity: '0.35'
  }
}

interface VirtualizedRowData {
  rawLine: string
  tokenLine?: ThemedToken[]
  showLineNumbers: boolean
}

/**
 * 单行代码渲染
 */
const VirtualizedRow = memo(
  ({ rawLine, tokenLine, showLineNumbers, index }: VirtualizedRowData & { index: number }) => {
    // 补全代码行 tokens，把原始内容拼接到高亮内容之后，确保渲染出整行来。
    const completeTokenLine = useMemo(() => {
      // 如果出现空行，补一个空元素保证行高
      if (rawLine.length === 0) {
        return [
          {
            content: '',
            offset: 0,
            ...plainTokenStyle
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
          ...plainTokenStyle
        }
      ]
    }, [rawLine, tokenLine])

    return (
      <div className="line">
        {showLineNumbers && <span className="line-number">{index + 1}</span>}
        <span className="line-content">
          {completeTokenLine.map((token, tokenIndex) => (
            <span key={tokenIndex} style={getReactStyleFromToken(token)}>
              {token.content}
            </span>
          ))}
        </span>
      </div>
    )
  }
)

VirtualizedRow.displayName = 'VirtualizedRow'

const ScrollContainer = styled.div<{
  $wrap?: boolean
  $expand?: boolean
  $lineHeight?: number
}>`
  display: block;
  overflow-x: auto;
  position: relative;
  border-radius: inherit;
  /* padding right 下沉到 line-content 中 */
  padding: 0.5em 0 0.5em 1em;

  .line {
    display: flex;
    align-items: flex-start;
    width: 100%;
    line-height: ${(props) => props.$lineHeight}px;
    /* contain 优化 wrap 时滚动性能，will-change 优化 unwrap 时滚动性能 */
    contain: ${(props) => (props.$wrap ? 'content' : 'none')};
    will-change: ${(props) => (!props.$wrap && !props.$expand ? 'transform' : 'auto')};

    .line-number {
      width: var(--gutter-width, 1.2ch);
      text-align: right;
      opacity: 0.35;
      margin-right: 1rem;
      user-select: none;
      flex-shrink: 0;
      overflow: hidden;
      font-family: inherit;
      font-variant-numeric: tabular-nums;
    }

    .line-content {
      flex: 1;
      padding-right: 1em;
      white-space: pre;
      * {
        white-space: ${(props) => (props.$wrap ? 'pre-wrap' : 'pre')};
        overflow-wrap: ${(props) => (props.$wrap ? 'break-word' : 'normal')};
      }
    }
  }
`

export default memo(CodeViewer)
