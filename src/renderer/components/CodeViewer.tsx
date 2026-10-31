import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual'
import type { EditorState } from '@uiw/react-codemirror'
import { debounce } from 'es-toolkit/compat'
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { CodeBlockHighlightResult as HighlightResult, CodeBlockToken } from '@cherrystudio/ui/code-block'
import { readCodeBlockState } from '@cherrystudio/ui/code-block'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCodeHighlight } from '@renderer/hooks/useCodeHighlight'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { codeViewerSelectionManager } from '@renderer/services/CodeViewerSelectionManager'
import { ImageCaptureEvent } from '@renderer/utils/image'
import { cn } from '@renderer/utils/style'
import { uuid } from '@renderer/utils/uuid'

const logger = loggerService.withContext('CodeViewer')

interface SourcePoint {
  line: number
  offset: number
}

interface SavedSelection {
  startLine: number
  startOffset: number
  endLine: number
  endOffset: number
}

interface CodeViewerProps {
  /** Seed visible syntax from the matching editor document when switching back to reading. */
  editorState?: EditorState | null
  /** Code string value. */
  value: string
  /**
   * Code language string.
   * - Case-insensitive.
   * - Supports common names: javascript, json, python, etc.
   * - Supports common aliases: c#/csharp, objective-c++/obj-c++/objc++, etc.
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
 * Virtualized code viewer with viewport-only highlighting in a worker.
 */
const CodeViewer = ({
  editorState,
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
  const { codeBlockStyle, isCodeThemeDark, highlightRange, cleanupTokenizers } = useCodeStyle()
  const [capture, setCapture] = useState<{ lines: string[]; tokens: HighlightResult | null } | null>(null)
  const captureCommitRef = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    captureCommitRef.current?.()
    captureCommitRef.current = null
  }, [capture])
  useLayoutEffect(() => () => captureCommitRef.current?.(), [])

  const shikiThemeRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const widthProbeRef = useRef<HTMLDivElement>(null)
  const callerId = useRef(`${Date.now()}-${uuid()}`).current
  const savedSelectionRef = useRef<SavedSelection | null>(null)
  const gestureRef = useRef<{ active: boolean; anchor: SourcePoint | null; focus: SourcePoint | null } | null>(null)
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

  const rawLines = useMemo(() => (typeof value === 'string' ? value.split('\n') : []), [value])

  useLayoutEffect(() => {
    const root = shikiThemeRef.current
    if (!root) return
    const prepare = async () => {
      const captureId = `${callerId}-capture`
      let captureTokens: HighlightResult | null = null
      try {
        if (highlight)
          captureTokens = await highlightRange(value, language, captureId, { start: 0, end: rawLines.length })
      } finally {
        if (highlight) cleanupTokenizers(captureId)
      }
      if (shikiThemeRef.current !== root) return () => {}
      const scrollTop = scrollerRef.current?.scrollTop ?? 0
      await new Promise<void>((resolve) => {
        captureCommitRef.current = resolve
        setCapture({ lines: rawLines, tokens: captureTokens })
      })
      return async () => {
        if (shikiThemeRef.current !== root) return
        await new Promise<void>((resolve) => {
          captureCommitRef.current = resolve
          setCapture(null)
        })
        if (scrollerRef.current) scrollerRef.current.scrollTop = scrollTop
      }
    }
    const onPrepare = (event: Event) => {
      if (event instanceof ImageCaptureEvent) event.preparations.push(prepare())
    }
    root.addEventListener(ImageCaptureEvent.type, onPrepare)
    return () => root.removeEventListener(ImageCaptureEvent.type, onPrepare)
  }, [callerId, cleanupTokenizers, highlight, highlightRange, language, rawLines, value])

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

  // 保存当前选区的逻辑位置
  const saveSelection = useCallback((): SavedSelection | null => {
    const gesture = gestureRef.current
    if (gesture && !gesture.active) return savedSelectionRef.current
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || (selection.isCollapsed && !gesture)) {
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
            element = lineContent
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

      const prefix = document.createRange()
      prefix.selectNodeContents(lineContent)
      prefix.setEnd(node, offset)
      const charOffset = prefix.toString().length

      logger.debug('findLineAndOffset result', {
        lineIndex,
        charOffset
      })

      return { line: lineIndex, offset: charOffset }
    }

    let start: SourcePoint | null
    let end: SourcePoint | null
    if (gesture) {
      gesture.anchor ??= selection.anchorNode && findLineAndOffset(selection.anchorNode, selection.anchorOffset)
      const focus = selection.focusNode && findLineAndOffset(selection.focusNode, selection.focusOffset)
      if (focus) gesture.focus = focus
      const { anchor } = gesture
      if (!anchor || !gesture.focus) return savedSelectionRef.current
      const forward =
        anchor.line < gesture.focus.line ||
        (anchor.line === gesture.focus.line && anchor.offset <= gesture.focus.offset)
      start = forward ? anchor : gesture.focus
      end = forward ? gesture.focus : anchor
    } else {
      start = findLineAndOffset(range.startContainer, range.startOffset)
      end = findLineAndOffset(range.endContainer, range.endOffset)
    }

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

    if (start.line === end.line && start.offset === end.offset) {
      savedSelectionRef.current = null
      return null
    }
    return { startLine: start.line, startOffset: start.offset, endLine: end.line, endOffset: end.offset }
  }, [selectionBelongsToViewer])

  // 滚动事件处理：保存选择用于复制，但不恢复（避免选择高亮问题）
  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current
    if (scroller && autoScrollToBottom && !expanded) {
      const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
      shouldStickToBottomRef.current = distanceToBottom <= 8
    }

    // 只保存选择状态用于复制，不在滚动时恢复选择
    const saved = saveSelection()
    if (saved) {
      savedSelectionRef.current = saved
      codeViewerSelectionManager.retain(scroller!)
      logger.debug('Selection saved for copy', {
        startLine: saved.startLine,
        endLine: saved.endLine
      })
    }
  }, [autoScrollToBottom, expanded, saveSelection])

  // 处理复制事件，确保跨虚拟滚动的复制能获取完整内容
  const handleCopy = useCallback(
    (event: ClipboardEvent) => {
      // During a pointer gesture, saveSelection keeps the source anchor even when Chromium reanchors the DOM range.
      const saved = saveSelection() ?? savedSelectionRef.current

      if (!saved) {
        logger.warn('Cannot get selection, using browser default')
        return
      }

      const { startLine, startOffset, endLine, endOffset } = saved

      logger.debug('Copy event', {
        startLine,
        endLine,
        startOffset,
        endOffset,
        expanded,
        usedSavedSelection: !!savedSelectionRef.current
      })

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
    },
    [expanded, saveSelection, rawLines]
  )

  // Virtualizer 配置
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  useLayoutEffect(() => {
    if (!expanded) {
      setScrollMargin(0)
      return
    }
    let parent = scrollerRef.current?.parentElement ?? null
    while (parent && !/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement
    if (parent === document.body || parent === document.documentElement) parent = null
    setScrollParent(parent)
    let previousMargin: number | undefined
    const updateMargin = () => {
      const list = listRef.current
      if (!list) return
      const nextMargin =
        list.getBoundingClientRect().top -
        (parent?.getBoundingClientRect().top ?? 0) +
        (parent?.scrollTop ?? window.scrollY) -
        (parent?.clientTop ?? 0)
      if (nextMargin === previousMargin) return
      previousMargin = nextMargin
      setScrollMargin(nextMargin)
    }
    updateMargin()
    const resizeObserver = new ResizeObserver(updateMargin)
    const mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList')) observeLayout()
      updateMargin()
    })
    const observeLayout = () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      // Watch the layout around the viewer, excluding its virtual rows and syntax tokens.
      for (let element: HTMLElement | null = shikiThemeRef.current; element; element = element.parentElement) {
        resizeObserver.observe(element)
        mutationObserver.observe(element, { attributeFilter: ['style', 'class'], childList: true })
        if (element === parent) break
        // A preceding sibling can move the viewer without resizing a fixed-height ancestor.
        for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
          resizeObserver.observe(sibling)
          mutationObserver.observe(sibling, { attributeFilter: ['style', 'class'] })
        }
      }
    }
    observeLayout()
    const target = parent ?? window
    target.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      target.removeEventListener('scroll', handleScroll)
    }
  }, [expanded, handleScroll])
  const getScrollElement = useCallback(() => (expanded ? scrollParent : scrollerRef.current), [expanded, scrollParent])
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
  const elementVirtualizer = useVirtualizer({
    count: rawLines.length,
    getScrollElement,
    getItemKey,
    estimateSize,
    overscan: 20,
    scrollMargin,
    enabled: !expanded || scrollParent !== null
  })
  const windowVirtualizer = useWindowVirtualizer({
    count: rawLines.length,
    getItemKey,
    estimateSize,
    overscan: 20,
    scrollMargin,
    enabled: expanded && scrollParent === null
  })
  const virtualizer = expanded && scrollParent === null ? windowVirtualizer : elementVirtualizer

  // measure() drops every cached size and mounted rows never re-run measureElement, so seed
  // the rebuild from the DOM. Real deltas apply first; after measure() they are estimate error.
  const remeasureRows = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || capture) return
    const rows = [...scroller.querySelectorAll<HTMLElement>('[data-index]')].map(
      (element) => [Number(element.dataset.index), element.offsetHeight] as const
    )
    for (const [index, height] of rows) virtualizer.resizeItem(index, height)
    virtualizer.measure()
    virtualizer.getTotalSize()
    const adjustBefore = virtualizer.shouldAdjustScrollPositionOnItemSizeChange
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false
    try {
      for (const [index, height] of rows) virtualizer.resizeItem(index, height)
    } finally {
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = adjustBefore
    }
    // React commits after paint; sync the height now so the reflowed rows cannot
    // flash a scrollbar for a frame.
    if (listRef.current) listRef.current.style.height = `${virtualizer.getTotalSize()}px`
  }, [capture, virtualizer])

  const previousRawLinesRef = useRef<string[] | null>(null)

  // Observe a zero-height width probe, never the scroller itself: syncing the list height
  // inside the callback must not resize the observed element (that trips the RO loop error).
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const probe = widthProbeRef.current
    if (!scroller || !probe) return

    let lastWidth = scroller.clientWidth
    const observer = new ResizeObserver(() => {
      const nextWidth = scroller.clientWidth
      if (nextWidth === lastWidth) return
      lastWidth = nextWidth
      if (wrapped) {
        remeasureRows()
      }
    })
    observer.observe(probe)
    return () => observer.disconnect()
  }, [expanded, remeasureRows, wrapped])

  const previousWrapLayoutSignatureRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const signature = `${wrapped}:${lineNumbers}:${gutterDigits}:${fontSize}`
    if (previousWrapLayoutSignatureRef.current === signature) return
    previousWrapLayoutSignatureRef.current = signature
    remeasureRows()
  }, [expanded, fontSize, gutterDigits, lineNumbers, remeasureRows, wrapped])

  useLayoutEffect(() => {
    if (!wrapped) {
      previousRawLinesRef.current = rawLines
      return
    }

    const previous = previousRawLinesRef.current
    previousRawLinesRef.current = rawLines
    if (!previous) return

    const scroller = scrollerRef.current
    for (const element of scroller?.querySelectorAll<HTMLElement>('[data-index]') ?? []) {
      const index = Number(element.dataset.index)
      if (previous[index] !== rawLines[index]) virtualizer.resizeItem(index, element.offsetHeight)
    }
  }, [expanded, rawLines, virtualizer, wrapped])

  const offset = virtualizer.scrollOffset ?? 0
  const viewportHeight = virtualizer.scrollRect?.height ?? 0
  const outsideViewport =
    expanded && (offset + viewportHeight < scrollMargin || offset > scrollMargin + virtualizer.getTotalSize())
  const virtualItems = outsideViewport ? [] : virtualizer.getVirtualItems()
  const firstIndex = virtualItems[0]?.index
  const lastIndex = virtualItems.at(-1)?.index
  const totalSize = virtualizer.getTotalSize()

  // 使用代码高亮 Hook
  const { tokens, highlightLines, resetHighlight } = useCodeHighlight({
    value,
    language,
    callerId
  })
  const matchesEditor = useMemo(() => editorState?.sliceDoc() === value, [editorState, value])
  const editorTokens = useMemo(
    () =>
      !tokens && highlight && matchesEditor && editorState && firstIndex !== undefined && lastIndex !== undefined
        ? readCodeBlockState(editorState, { start: firstIndex, end: lastIndex + 1 })
        : null,
    [tokens, highlight, matchesEditor, editorState, firstIndex, lastIndex]
  )

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
    if (firstIndex === undefined || lastIndex === undefined || !shikiTheme) return

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
        void debouncedHighlightLines(firstIndex, lastIndex + 1)
        return
      }
      void highlightLines(firstIndex, lastIndex + 1)
      return
    }

    void debouncedHighlightLines(firstIndex, lastIndex + 1)
  }, [firstIndex, lastIndex, debouncedHighlightLines, highlightLines, highlight])

  // Monitor selection changes, clear stale selection state, and auto-expand in collapsed state
  const handleSelectionChange = useCallback(
    (selection: Selection | null) => {
      if (!selection || !selectionBelongsToViewer(selection)) {
        savedSelectionRef.current = null
        gestureRef.current = null
        return
      }

      const current = saveSelection()
      if (current) {
        savedSelectionRef.current = current
        codeViewerSelectionManager.retain(scrollerRef.current!)
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
    },
    [expanded, onRequestExpand, saveSelection, selectionBelongsToViewer]
  )
  const selectionChangeHandlerRef = useRef(handleSelectionChange)
  const copyHandlerRef = useRef(handleCopy)
  const gestureHandlerRef = useRef<(active: boolean) => void>(() => {})

  useLayoutEffect(() => {
    selectionChangeHandlerRef.current = handleSelectionChange
    copyHandlerRef.current = handleCopy
    gestureHandlerRef.current = (active) => {
      if (active) {
        gestureRef.current = { active: true, anchor: null, focus: null }
      } else if (gestureRef.current) {
        savedSelectionRef.current = saveSelection()
        gestureRef.current.active = false
      }
    }
  }, [handleSelectionChange, handleCopy, saveSelection])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    return codeViewerSelectionManager.register(
      scroller,
      (selection) => selectionChangeHandlerRef.current(selection),
      (event) => copyHandlerRef.current(event),
      (active) => gestureHandlerRef.current(active)
    )
  }, [])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (scroller) codeViewerSelectionManager.release(scroller)
  }, [value])

  // Report scrollHeight when it might change
  useLayoutEffect(() => {
    onHeightChange?.(scrollerRef.current?.scrollHeight ?? 0)
  }, [rawLines.length, onHeightChange])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !autoScrollToBottom || expanded || !shouldStickToBottomRef.current) return

    scroller.scrollTop = scroller.scrollHeight
  }, [autoScrollToBottom, expanded, rawLines.length, totalSize])

  const renderedLines = capture?.lines ?? rawLines
  const renderedTokens = capture ? capture.tokens : (tokens ?? editorTokens)
  const renderedItems = capture ? capture.lines.map((_, index) => ({ key: index, index })) : virtualItems

  return (
    <div
      ref={shikiThemeRef}
      data-image-capture-content=""
      className={cn('code-viewer shiki highlights', isCodeThemeDark ? 'shiki-dark' : 'shiki-light', className)}
      style={{
        ...codeBlockStyle,
        color: 'var(--code-foreground, var(--foreground))',
        backgroundColor: 'var(--code-background, transparent)',
        fontFamily: 'var(--code-font-family)',
        ...(expanded || capture ? {} : { height })
      }}>
      <div ref={widthProbeRef} aria-hidden="true" data-width-probe className="h-0" />
      <div
        ref={scrollerRef}
        className="shiki-scroller selectable relative block [scrollbar-color:auto] overflow-x-auto rounded-[inherit] pr-0 pl-[1em]"
        onScroll={handleScroll}
        style={
          {
            '--gutter-width': `${gutterDigits}ch`,
            '--line-height': `${lineHeight}px`,
            fontSize,
            paddingBlock: Math.round(fontSize / 2),
            tabSize: 2,
            height: expanded || capture ? undefined : height,
            maxHeight: expanded || capture ? undefined : maxHeight,
            overflowY: capture ? 'visible' : expanded ? 'hidden' : 'auto'
          } as React.CSSProperties
        }>
        <div
          ref={listRef}
          className="shiki-list"
          style={{
            height: capture ? 'auto' : `${totalSize}px`,
            width: '100%',
            position: 'relative'
          }}>
          <div
            style={{
              position: capture ? 'relative' : 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: capture
                ? undefined
                : `translateY(${(virtualItems[0]?.start ?? scrollMargin) - scrollMargin}px)`
            }}>
            {renderedItems.map((virtualItem) => (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={capture ? undefined : virtualizer.measureElement}>
                <VirtualizedRow
                  rawLine={renderedLines[virtualItem.index]}
                  tokenLine={highlight ? renderedTokens?.lines[virtualItem.index - renderedTokens.start] : undefined}
                  showLineNumbers={lineNumbers}
                  expanded={expanded}
                  wrapped={wrapped}
                  index={virtualItem.index}
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

interface VirtualizedRowData {
  rawLine: string
  tokenLine?: CodeBlockToken[]
  showLineNumbers: boolean
  expanded: boolean
  wrapped: boolean
}

/**
 * 单行代码渲染
 */
const VirtualizedRow = memo(
  ({ rawLine, tokenLine, showLineNumbers, expanded, wrapped, index }: VirtualizedRowData & { index: number }) => {
    const completeTokenLine = useMemo(() => {
      const tokens = tokenLine ?? []
      const length = tokens.reduce((total, token) => total + token.content.length, 0)
      return tokens.length && length >= rawLine.length
        ? tokens
        : [...tokens, { content: rawLine.slice(length), offset: length }]
    }, [rawLine, tokenLine])

    return (
      <div
        className="line flex min-h-[var(--line-height)] w-full items-start leading-[var(--line-height)]"
        style={{
          contain: wrapped ? 'content' : 'none',
          willChange: !wrapped && !expanded ? 'transform' : 'auto'
        }}>
        {showLineNumbers && (
          <span
            className="line-number mr-4 shrink-0 overflow-hidden text-right font-[inherit] tabular-nums opacity-[0.35] select-none"
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
            'line-content min-w-0 flex-1 pr-[1em] whitespace-pre',
            wrapped ? '[&_*]:break-words! [&_*]:whitespace-pre-wrap!' : '[&_*]:break-normal [&_*]:whitespace-pre'
          )}>
          {completeTokenLine.map((token, tokenIndex) => (
            <span key={tokenIndex} className={token.className}>
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
