import { ExpandAltOutlined, ShrinkOutlined } from '@ant-design/icons'
import { useToolbar } from '@renderer/components/CodeView/context'
import UnWrapIcon from '@renderer/components/Icons/UnWrapIcon'
import WrapIcon from '@renderer/components/Icons/WrapIcon'
import { useSyntaxHighlighter } from '@renderer/context/SyntaxHighlighterProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import React, { memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  children: string
  language: string
}

const SourcePreview = ({ ref, children, language }: Props & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const { codeShowLineNumbers, fontSize, codeCollapsible, codeWrappable } = useSettings()
  const { codeToHtml } = useSyntaxHighlighter()
  const [isExpanded, setIsExpanded] = useState(!codeCollapsible)
  const [isUnwrapped, setIsUnwrapped] = useState(!codeWrappable)
  const codeContentRef = useRef<HTMLDivElement>(null)
  const childrenLengthRef = useRef(0)
  const isStreamingRef = useRef(false)

  const [showExpandButton, setShowExpandButton] = useState(false)
  const showExpandButtonRef = useRef(false)
  const { t } = useTranslation()

  // 合并引用
  useImperativeHandle(ref, () => codeContentRef.current!, [])

  const { registerTool, removeTool } = useToolbar()

  // 展开/折叠工具
  useEffect(() => {
    registerTool({
      id: 'expand',
      type: 'quick',
      icon: isExpanded ? <ShrinkOutlined /> : <ExpandAltOutlined />,
      tooltip: isExpanded ? t('code_block.collapse') : t('code_block.expand'),
      condition: () => codeCollapsible && showExpandButton,
      onClick: () => setIsExpanded(!isExpanded),
      order: 1
    })

    return () => removeTool('expand')
  }, [codeCollapsible, isExpanded, registerTool, removeTool, showExpandButton, t])

  // 自动换行工具
  useEffect(() => {
    registerTool({
      id: 'wrap',
      type: 'quick',
      icon: isUnwrapped ? <WrapIcon /> : <UnWrapIcon />,
      tooltip: isUnwrapped ? t('code_block.wrap.on') : t('code_block.wrap.off'),
      condition: () => codeWrappable,
      onClick: () => setIsUnwrapped(!isUnwrapped),
      order: 0
    })

    return () => removeTool('wrap')
  }, [codeWrappable, isUnwrapped, registerTool, removeTool, t])

  const highlightCode = useCallback(async () => {
    if (!codeContentRef.current) return
    const codeElement = codeContentRef.current

    // 只在非流式输出状态才尝试启用cache
    const highlightedHtml = await codeToHtml(children, language, !isStreamingRef.current)

    codeElement.innerHTML = highlightedHtml
    codeElement.style.opacity = '1'

    const isShowExpandButton = codeElement.scrollHeight > 350
    if (showExpandButtonRef.current === isShowExpandButton) return
    showExpandButtonRef.current = isShowExpandButton
    setShowExpandButton(showExpandButtonRef.current)
  }, [language, codeToHtml, children])

  useEffect(() => {
    // 跳过非文本代码块
    if (!codeContentRef.current) return

    let isMounted = true
    const codeElement = codeContentRef.current

    if (childrenLengthRef.current > 0 && childrenLengthRef.current !== children?.length) {
      isStreamingRef.current = true
    } else {
      isStreamingRef.current = false
      codeElement.style.opacity = '0.1'
    }

    if (childrenLengthRef.current === 0) {
      // 挂载时显示原始代码
      codeElement.textContent = children
    }

    const observer = new IntersectionObserver(async (entries) => {
      if (entries[0].isIntersecting && isMounted) {
        setTimeout(highlightCode, 0)
        observer.disconnect()
      }
    })

    observer.observe(codeElement)

    return () => {
      childrenLengthRef.current = children?.length
      isMounted = false
      observer.disconnect()
    }
  }, [children, highlightCode, language])

  useEffect(() => {
    setIsExpanded(!codeCollapsible)
    setShowExpandButton(codeCollapsible && (codeContentRef.current?.scrollHeight ?? 0) > 350)
  }, [codeCollapsible])

  useEffect(() => {
    setIsUnwrapped(!codeWrappable)
  }, [codeWrappable])

  return (
    <CodeContent
      ref={codeContentRef}
      isShowLineNumbers={codeShowLineNumbers}
      isUnwrapped={isUnwrapped}
      isCodeWrappable={codeWrappable}
      style={{
        border: '0.5px solid var(--color-code-background)',
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        marginTop: 0,
        fontSize: fontSize - 1,
        maxHeight: codeCollapsible && !isExpanded ? '350px' : 'none',
        overflow: codeCollapsible && !isExpanded ? 'auto' : 'visible',
        position: 'relative'
      }}
    />
  )
}

SourcePreview.displayName = 'SourcePreview'

const CodeContent = styled.div<{ isShowLineNumbers: boolean; isUnwrapped: boolean; isCodeWrappable: boolean }>`
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
        padding-left: ${(props) => (props.isShowLineNumbers ? '2rem' : '0')};
      }
    }
  }

  ${(props) =>
    props.isShowLineNumbers &&
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
    props.isCodeWrappable &&
    !props.isUnwrapped &&
    `
      code .line * {
        word-wrap: break-word;
        white-space: pre-wrap;
      }
    `}
`

export default memo(SourcePreview)
