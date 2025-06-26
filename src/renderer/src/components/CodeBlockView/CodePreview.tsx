import { CodeTool, TOOL_SPECS, useCodeTool } from '@renderer/components/CodeToolbar'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { uuid } from '@renderer/utils'
import { getReactStyleFromToken } from '@renderer/utils/shiki'
import { ChevronsDownUp, ChevronsUpDown, Text as UnWrapIcon, WrapText as WrapIcon } from 'lucide-react'
import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemedToken } from 'shiki/core'
import styled from 'styled-components'

interface CodePreviewProps {
  children: string
  language: string
  setTools?: (value: React.SetStateAction<CodeTool[]>) => void
}

/**
 * Shiki 流式代码高亮组件
 *
 * - 通过 shiki tokenizer 处理流式响应，高性能
 * - 进入视口后触发高亮，改善页面内有大量长代码块时的响应
 * - 并发安全
 */
const CodePreview = ({ children, language, setTools }: CodePreviewProps) => {
  const { codeShowLineNumbers, fontSize, codeCollapsible, codeWrappable } = useSettings()
  const { activeShikiTheme, highlightStreamingCode, cleanupTokenizers } = useCodeStyle()
  const [isExpanded, setIsExpanded] = useState(!codeCollapsible)
  const [isUnwrapped, setIsUnwrapped] = useState(!codeWrappable)
  const [tokenLines, setTokenLines] = useState<ThemedToken[][]>([])
  const [isInViewport, setIsInViewport] = useState(false)
  const codeContainerRef = useRef<HTMLDivElement>(null)
  const processingRef = useRef(false)
  const latestRequestedContentRef = useRef<string | null>(null)
  const callerId = useRef(`${Date.now()}-${uuid()}`).current
  const shikiThemeRef = useRef(activeShikiTheme)

  const { t } = useTranslation()

  const { registerTool, removeTool } = useCodeTool(setTools)

  // 展开/折叠工具
  useEffect(() => {
    registerTool({
      ...TOOL_SPECS.expand,
      icon: isExpanded ? <ChevronsDownUp className="icon" /> : <ChevronsUpDown className="icon" />,
      tooltip: isExpanded ? t('code_block.collapse') : t('code_block.expand'),
      visible: () => {
        const scrollHeight = codeContainerRef.current?.scrollHeight
        return codeCollapsible && (scrollHeight ?? 0) > 350
      },
      onClick: () => setIsExpanded((prev) => !prev)
    })

    return () => removeTool(TOOL_SPECS.expand.id)
  }, [codeCollapsible, isExpanded, registerTool, removeTool, t])

  // 自动换行工具
  useEffect(() => {
    registerTool({
      ...TOOL_SPECS.wrap,
      icon: isUnwrapped ? <WrapIcon className="icon" /> : <UnWrapIcon className="icon" />,
      tooltip: isUnwrapped ? t('code_block.wrap.on') : t('code_block.wrap.off'),
      visible: () => codeWrappable,
      onClick: () => setIsUnwrapped((prev) => !prev)
    })

    return () => removeTool(TOOL_SPECS.wrap.id)
  }, [codeWrappable, isUnwrapped, registerTool, removeTool, t])

  // 更新展开状态
  useEffect(() => {
    setIsExpanded(!codeCollapsible)
  }, [codeCollapsible])

  // 更新换行状态
  useEffect(() => {
    setIsUnwrapped(!codeWrappable)
  }, [codeWrappable])

  const highlightCode = useCallback(async () => {
    const currentContent = typeof children === 'string' ? children.trimEnd() : ''

    // 记录最新要处理的内容，为了保证最终状态正确
    latestRequestedContentRef.current = currentContent

    // 如果正在处理，先跳出，等到完成后会检查是否有新内容
    if (processingRef.current) return

    processingRef.current = true

    try {
      // 循环处理，确保会处理最新内容
      while (latestRequestedContentRef.current !== null) {
        const contentToProcess = latestRequestedContentRef.current
        latestRequestedContentRef.current = null // 标记开始处理

        // 传入完整内容，让 ShikiStreamService 检测变化并处理增量高亮
        const result = await highlightStreamingCode(contentToProcess, language, callerId)

        // 如有结果，更新 tokenLines
        if (result.lines.length > 0 || result.recall !== 0) {
          setTokenLines((prev) => {
            return result.recall === -1
              ? result.lines
              : [...prev.slice(0, Math.max(0, prev.length - result.recall)), ...result.lines]
          })
        }
      }
    } finally {
      processingRef.current = false
    }
  }, [highlightStreamingCode, language, callerId, children])

  // 主题变化时强制重新高亮
  useEffect(() => {
    if (shikiThemeRef.current !== activeShikiTheme) {
      shikiThemeRef.current = activeShikiTheme
      cleanupTokenizers(callerId)
      setTokenLines([])
    }
  }, [activeShikiTheme, callerId, cleanupTokenizers])

  // 组件卸载时清理资源
  useEffect(() => {
    return () => cleanupTokenizers(callerId)
  }, [callerId, cleanupTokenizers])

  // 视口检测逻辑，进入视口后触发第一次代码高亮
  useEffect(() => {
    const codeElement = codeContainerRef.current
    if (!codeElement) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].intersectionRatio > 0) {
          setIsInViewport(true)
          observer.disconnect()
        }
      },
      {
        rootMargin: '50px 0px 50px 0px'
      }
    )

    observer.observe(codeElement)
    return () => observer.disconnect()
  }, []) // 只执行一次

  // 触发代码高亮
  useEffect(() => {
    if (!isInViewport) return

    setTimeout(highlightCode, 0)
  }, [isInViewport, highlightCode])

  useEffect(() => {
    const container = codeContainerRef.current
    if (!container || !codeShowLineNumbers) return

    const digits = Math.max(tokenLines.length.toString().length, 1)
    container.style.setProperty('--line-digits', digits.toString())
  }, [codeShowLineNumbers, tokenLines.length])

  const hasHighlightedCode = tokenLines.length > 0

  return (
    <ContentContainer
      ref={codeContainerRef}
      $lineNumbers={codeShowLineNumbers}
      $wrap={codeWrappable && !isUnwrapped}
      $fadeIn={hasHighlightedCode}
      style={{
        fontSize: fontSize - 1,
        maxHeight: codeCollapsible && !isExpanded ? '350px' : 'none'
      }}>
      {hasHighlightedCode ? (
        <ShikiTokensRenderer language={language} tokenLines={tokenLines} />
      ) : (
        <CodePlaceholder>{children}</CodePlaceholder>
      )}
    </ContentContainer>
  )
}

/**
 * 渲染 Shiki 高亮后的 tokens
 *
 * 独立出来，方便将来做 virtual list
 */
const ShikiTokensRenderer: React.FC<{ language: string; tokenLines: ThemedToken[][] }> = memo(
  ({ language, tokenLines }) => {
    const { getShikiPreProperties } = useCodeStyle()
    const rendererRef = useRef<HTMLPreElement>(null)

    // 设置 pre 标签属性
    useEffect(() => {
      getShikiPreProperties(language).then((properties) => {
        const pre = rendererRef.current
        if (pre) {
          pre.className = properties.class
          pre.style.cssText = properties.style
          pre.tabIndex = properties.tabindex
        }
      })
    }, [language, getShikiPreProperties])

    return (
      <pre className="shiki" ref={rendererRef}>
        <code>
          {tokenLines.map((lineTokens, lineIndex) => (
            <span key={`line-${lineIndex}`} className="line">
              {lineTokens.map((token, tokenIndex) => (
                <span key={`token-${tokenIndex}`} style={getReactStyleFromToken(token)}>
                  {token.content}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    )
  }
)

const ContentContainer = styled.div<{
  $lineNumbers: boolean
  $wrap: boolean
  $fadeIn: boolean
}>`
  position: relative;
  overflow: auto;
  border-radius: inherit;
  margin-top: 0;

  /* 动态宽度计算 */
  --line-digits: 0;
  --gutter-width: max(calc(var(--line-digits) * 0.7rem), 2.1rem);

  .shiki {
    padding: 1em;
    border-radius: inherit;

    code {
      display: flex;
      flex-direction: column;

      .line {
        display: block;
        min-height: 1.3rem;
        padding-left: ${(props) => (props.$lineNumbers ? 'var(--gutter-width)' : '0')};

        * {
          overflow-wrap: ${(props) => (props.$wrap ? 'break-word' : 'normal')};
          white-space: ${(props) => (props.$wrap ? 'pre-wrap' : 'pre')};
        }
      }
    }
  }

  ${(props) =>
    props.$lineNumbers &&
    `
      code {
        counter-reset: step;
        counter-increment: step 0;
        position: relative;
      }

      code .line::before {
        content: counter(step);
        counter-increment: step;
        width: 1rem;
        position: absolute;
        left: 0;
        text-align: right;
        opacity: 0.35;
      }
    `}

  @keyframes contentFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  animation: ${(props) => (props.$fadeIn ? 'contentFadeIn 0.1s ease-in forwards' : 'none')};
`

const CodePlaceholder = styled.div`
  display: block;
  opacity: 0.1;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-x: hidden;
  min-height: 1.3rem;
`

CodePreview.displayName = 'CodePreview'

export default memo(CodePreview)
