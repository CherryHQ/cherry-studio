import { MAX_COLLAPSED_CODE_HEIGHT } from '@renderer/config/constant'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useCodeHighlight } from '@renderer/hooks/useCodeHighlight'
import { useSettings } from '@renderer/hooks/useSettings'
import { uuid } from '@renderer/utils'
import { getReactStyleFromToken } from '@renderer/utils/shiki'
import { useVirtualizer } from '@tanstack/react-virtual'
import { debounce } from 'lodash'
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { ThemedToken } from 'shiki/core'
import styled from 'styled-components'

interface CodeViewerProps {
  language: string
  children: string
  expanded?: boolean
  unwrapped?: boolean
  onHeightChange?: (scrollHeight: number) => void
  className?: string
}

/**
 * Shiki 流式代码高亮组件
 * - 通过 shiki tokenizer 处理流式响应，高性能
 * - 使用虚拟滚动和按需高亮，改善页面内有大量长代码块时的响应
 * - 并发安全
 */
const CodeViewer = ({ children, language, expanded, unwrapped, onHeightChange, className }: CodeViewerProps) => {
  const { codeShowLineNumbers, fontSize } = useSettings()
  const { getShikiPreProperties, isShikiThemeDark } = useCodeStyle()
  const shikiThemeRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const callerId = useRef(`${Date.now()}-${uuid()}`).current

  const rawLines = useMemo(() => (typeof children === 'string' ? children.trimEnd().split('\n') : []), [children])

  // 计算行号数字位数
  const gutterDigits = useMemo(
    () => (codeShowLineNumbers ? Math.max(rawLines.length.toString().length, 1) : 0),
    [codeShowLineNumbers, rawLines.length]
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
        shikiTheme.tabIndex = properties.tabindex
      }
    })
    return () => {
      mounted = false
    }
  }, [language, getShikiPreProperties, isShikiThemeDark, className])

  // Virtualizer 配置
  const getScrollElement = useCallback(() => scrollerRef.current, [])
  const getItemKey = useCallback((index: number) => `${callerId}-${index}`, [callerId])
  // `line-height: 1.6` 为全局样式，但是为了避免测量误差在这里取整
  const estimateSize = useCallback(() => Math.round((fontSize - 1) * 1.6), [fontSize])

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

  // Report scrollHeight when it might change
  useLayoutEffect(() => {
    onHeightChange?.(scrollerRef.current?.scrollHeight ?? 0)
  }, [rawLines.length, onHeightChange])

  return (
    <div ref={shikiThemeRef}>
      <ScrollContainer
        ref={scrollerRef}
        className="shiki-scroller"
        $wrap={!unwrapped}
        $expanded={expanded}
        $lineHeight={estimateSize()}
        style={
          {
            '--gutter-width': `${gutterDigits}ch`,
            fontSize: `${fontSize - 1}px`,
            maxHeight: expanded ? undefined : MAX_COLLAPSED_CODE_HEIGHT,
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
                  showLineNumbers={codeShowLineNumbers}
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
  $expanded?: boolean
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
    will-change: ${(props) => (!props.$wrap && !props.$expanded ? 'transform' : 'auto')};

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
      * {
        white-space: ${(props) => (props.$wrap ? 'pre-wrap' : 'pre')};
        overflow-wrap: ${(props) => (props.$wrap ? 'break-word' : 'normal')};
      }
    }
  }
`

export default memo(CodeViewer)
