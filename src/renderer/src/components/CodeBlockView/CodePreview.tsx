import { TOOL_SPECS, useCodeToolbar } from '@renderer/components/CodeToolbar'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { uuid } from '@renderer/utils'
import { getReactStyleFromToken } from '@renderer/utils/shiki'
import { ChevronsDownUp, ChevronsUpDown, Text as UnWrapIcon, WrapText as WrapIcon } from 'lucide-react'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ThemedToken } from 'shiki/core'
import styled from 'styled-components'

interface CodePreviewProps {
  children: string
  language: string
}

/**
 * Shiki 流式代码高亮组件
 *
 * - 通过 shiki tokenizer 处理流式响应
 * - 为了正确执行语法高亮，必须保证流式响应都依次到达 tokenizer，不能跳过
 */
const CodePreview = ({ children, language }: CodePreviewProps) => {
  const { codeShowLineNumbers, fontSize, codeCollapsible, codeWrappable } = useSettings()
  const { activeShikiTheme, highlightCodeChunk, cleanupTokenizers } = useCodeStyle()
  const [isExpanded, setIsExpanded] = useState(!codeCollapsible)
  const [isUnwrapped, setIsUnwrapped] = useState(!codeWrappable)
  const [tokenLines, setTokenLines] = useState<ThemedToken[][]>([])
  const codeContentRef = useRef<HTMLDivElement>(null)
  const prevCodeLengthRef = useRef(0)
  const safeCodeStringRef = useRef(children)
  const highlightQueueRef = useRef<Promise<void>>(Promise.resolve())
  const callerId = useRef(`${Date.now()}-${uuid()}`).current
  const shikiThemeRef = useRef(activeShikiTheme)

  const { t } = useTranslation()

  const { registerTool, removeTool } = useCodeToolbar()

  // 展开/折叠工具
  useEffect(() => {
    registerTool({
      ...TOOL_SPECS.expand,
      icon: isExpanded ? <ChevronsDownUp className="icon" /> : <ChevronsUpDown className="icon" />,
      tooltip: isExpanded ? t('code_block.collapse') : t('code_block.expand'),
      visible: () => {
        const scrollHeight = codeContentRef.current?.scrollHeight
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

  // 处理尾部空白字符
  const safeCodeString = useMemo(() => {
    return typeof children === 'string' ? children.trimEnd() : ''
  }, [children])

  const highlightCode = useCallback(async () => {
    if (!safeCodeString) return

    if (prevCodeLengthRef.current === safeCodeString.length) return

    // 捕获当前状态
    const startPos = prevCodeLengthRef.current
    const endPos = safeCodeString.length

    // 添加到处理队列，确保按顺序处理
    highlightQueueRef.current = highlightQueueRef.current.then(async () => {
      // FIXME: 长度有问题，或者破坏了流式内容，需要清理 tokenizer 并使用完整代码重新高亮
      if (prevCodeLengthRef.current > safeCodeString.length || !safeCodeString.startsWith(safeCodeStringRef.current)) {
        cleanupTokenizers(callerId)
        prevCodeLengthRef.current = 0
        safeCodeStringRef.current = ''

        const result = await highlightCodeChunk(safeCodeString, language, callerId)
        setTokenLines(result.lines)

        prevCodeLengthRef.current = safeCodeString.length
        safeCodeStringRef.current = safeCodeString

        return
      }

      // 跳过 race condition，延迟到后续任务
      if (prevCodeLengthRef.current !== startPos) {
        return
      }

      const incrementalCode = safeCodeString.slice(startPos, endPos)
      const result = await highlightCodeChunk(incrementalCode, language, callerId)
      setTokenLines((lines) => [...lines.slice(0, Math.max(0, lines.length - result.recall)), ...result.lines])
      prevCodeLengthRef.current = endPos
      safeCodeStringRef.current = safeCodeString
    })
  }, [callerId, cleanupTokenizers, highlightCodeChunk, language, safeCodeString])

  // 主题变化时强制重新高亮
  useEffect(() => {
    if (shikiThemeRef.current !== activeShikiTheme) {
      prevCodeLengthRef.current++
      shikiThemeRef.current = activeShikiTheme
    }
  }, [activeShikiTheme])

  // 组件卸载时清理资源
  useEffect(() => {
    return () => cleanupTokenizers(callerId)
  }, [callerId, cleanupTokenizers])

  // 处理第二次开始的代码高亮
  useEffect(() => {
    if (prevCodeLengthRef.current > 0) {
      setTimeout(highlightCode, 0)
    }
  }, [highlightCode])

  // 视口检测逻辑，只处理第一次代码高亮
  useEffect(() => {
    const codeElement = codeContentRef.current
    if (!codeElement || prevCodeLengthRef.current > 0) return

    let isMounted = true

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && isMounted) {
        setTimeout(highlightCode, 0)
        observer.disconnect()
      }
    })

    observer.observe(codeElement)

    return () => {
      isMounted = false
      observer.disconnect()
    }
  }, [highlightCode])

  return (
    <ContentContainer
      ref={codeContentRef}
      $isShowLineNumbers={codeShowLineNumbers}
      $isUnwrapped={isUnwrapped}
      $isCodeWrappable={codeWrappable}
      style={{
        fontSize: fontSize - 1,
        maxHeight: codeCollapsible && !isExpanded ? '350px' : 'none',
        overflow: codeCollapsible && !isExpanded ? 'auto' : 'visible'
      }}>
      {tokenLines.length > 0 ? (
        <ShikiTokensRenderer language={language} tokenLines={tokenLines} />
      ) : (
        <div style={{ opacity: 0.1 }}>{children}</div>
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
  $isShowLineNumbers: boolean
  $isUnwrapped: boolean
  $isCodeWrappable: boolean
}>`
  position: relative;
  border: 0.5px solid transparent;
  border-radius: 5px;
  margin-top: 0;
  transition: opacity 0.3s ease;

  .shiki {
    padding: 1em;

    code {
      display: flex;
      flex-direction: column;
      width: 100%;

      .line {
        display: block;
        min-height: 1.3rem;
        padding-left: ${(props) => (props.$isShowLineNumbers ? '2rem' : '0')};
      }
    }
  }

  ${(props) =>
    props.$isShowLineNumbers &&
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

  ${(props) =>
    props.$isCodeWrappable &&
    !props.$isUnwrapped &&
    `
      code .line * {
        word-wrap: break-word;
        white-space: pre-wrap;
      }
    `}
`

CodePreview.displayName = 'CodePreview'

export default memo(CodePreview)
