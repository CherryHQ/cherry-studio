import { CheckOutlined, DownloadOutlined, ExpandAltOutlined, MenuOutlined, ShrinkOutlined } from '@ant-design/icons'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import UnWrapIcon from '@renderer/components/Icons/UnWrapIcon'
import WrapIcon from '@renderer/components/Icons/WrapIcon'
import { HStack } from '@renderer/components/Layout'
import { useSyntaxHighlighter } from '@renderer/context/SyntaxHighlighterProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { extractTitle } from '@renderer/utils/formats'
import { Dropdown, Tooltip } from 'antd'
import dayjs from 'dayjs'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import Artifacts from './Artifacts'
import Mermaid from './Mermaid'
import { isValidPlantUML, PlantUML } from './PlantUML'
import SvgPreview from './SvgPreview'

interface CodeBlockProps {
  children: string
  className?: string
  [key: string]: any
}

const CodeBlock: React.FC<CodeBlockProps> = ({ children, className }) => {
  const match = /language-(\w+)/.exec(className || '') || children?.includes('\n')
  const { codeShowLineNumbers, fontSize, codeCollapsible, codeWrappable } = useSettings()
  const language = match?.[1] ?? 'text'
  // const [html, setHtml] = useState<string>('')
  const { codeToHtml } = useSyntaxHighlighter()
  const [isExpanded, setIsExpanded] = useState(!codeCollapsible)
  const [isUnwrapped, setIsUnwrapped] = useState(!codeWrappable)
  const codeContentRef = useRef<HTMLDivElement>(null)
  const childrenLengthRef = useRef(0)
  const isStreamingRef = useRef(false)
  const { t } = useTranslation()

  const [showExpandButton, setShowExpandButton] = useState(false)
  const showExpandButtonRef = useRef(false)

  const shouldHighlight = useCallback((lang: string) => {
    const NON_HIGHLIGHT_LANGS = ['mermaid', 'plantuml', 'svg']
    return !NON_HIGHLIGHT_LANGS.includes(lang)
  }, [])

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
    if (!codeContentRef.current || !shouldHighlight(language)) return

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
  }, [children, highlightCode, language, shouldHighlight])

  useEffect(() => {
    setIsExpanded(!codeCollapsible)
    setShowExpandButton(codeCollapsible && (codeContentRef.current?.scrollHeight ?? 0) > 350)
  }, [codeCollapsible])

  useEffect(() => {
    setIsUnwrapped(!codeWrappable)
  }, [codeWrappable])

  const renderSourceCode = useCallback(() => {
    return (
      <CodeContent
        ref={codeContentRef}
        isShowLineNumbers={codeShowLineNumbers}
        isUnwrapped={isUnwrapped}
        isCodeWrappable={codeWrappable}
        // dangerouslySetInnerHTML={{ __html: html }}
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
  }, [codeShowLineNumbers, codeWrappable, codeCollapsible, isExpanded, isUnwrapped, codeContentRef, fontSize])

  const onDownloadCode = useCallback((children: string, language: string) => {
    let fileName = ''

    // 尝试提取标题
    if (language === 'html' && children.includes('</html>')) {
      const title = extractTitle(children)
      if (title) {
        fileName = `${title}.html`
      }
    }

    // 默认使用日期格式命名
    if (!fileName) {
      fileName = `${dayjs().format('YYYYMMDDHHmm')}.${language}`
    }

    window.api.file.save(fileName, children)
  }, [])

  const moreMenuItems = useMemo(
    () => [
      {
        key: 'download',
        label: t('code_block.download'),
        icon: <DownloadOutlined />,
        onClick: () => onDownloadCode(children, language)
      }
    ],
    [t, onDownloadCode, children, language]
  )

  if (language === 'mermaid') {
    return <Mermaid chart={children} />
  }

  if (language === 'plantuml' && isValidPlantUML(children)) {
    return <PlantUML diagram={children} />
  }

  if (language === 'svg') {
    return (
      <CodeBlockWrapper className="code-block">
        <CodeHeader>
          <CodeLanguage>{'<SVG>'}</CodeLanguage>
        </CodeHeader>
        <StickyWrapper>
          <HStack
            position="absolute"
            gap={12}
            alignItems="center"
            style={{ bottom: '0.2rem', right: '1rem', height: '27px' }}>
            <CopyButton text={children} />
            <Dropdown menu={{ items: moreMenuItems }} trigger={['click']} placement="topRight" arrow>
              <CodeBlockStickyTool>
                <MenuOutlined />
              </CodeBlockStickyTool>
            </Dropdown>
          </HStack>
        </StickyWrapper>
        <SvgPreview>{children}</SvgPreview>
      </CodeBlockWrapper>
    )
  }

  return match ? (
    <CodeBlockWrapper className="code-block">
      <CodeHeader>
        <CodeLanguage>{'<' + language.toUpperCase() + '>'}</CodeLanguage>
      </CodeHeader>
      <StickyWrapper>
        <HStack
          position="absolute"
          gap={12}
          alignItems="center"
          style={{ bottom: '0.2rem', right: '1rem', height: '27px' }}>
          {showExpandButton && <ExpandButton expanded={isExpanded} onClick={() => setIsExpanded(!isExpanded)} />}
          {codeWrappable && <UnwrapButton unwrapped={isUnwrapped} onClick={() => setIsUnwrapped(!isUnwrapped)} />}
          <CopyButton text={children} />
          <Dropdown menu={{ items: moreMenuItems }} trigger={['click']} placement="topRight" arrow>
            <Tooltip title={t('code_block.more')}>
              <CodeBlockStickyTool>
                <MenuOutlined />
              </CodeBlockStickyTool>
            </Tooltip>
          </Dropdown>
        </HStack>
      </StickyWrapper>
      {renderSourceCode()}
      {language === 'html' && children?.includes('</html>') && <Artifacts html={children} />}
    </CodeBlockWrapper>
  ) : (
    <code className={className}>{children}</code>
  )
}

const ExpandButton: React.FC<{ expanded: boolean; onClick: () => void }> = ({ expanded, onClick }) => {
  const { t } = useTranslation()
  return (
    <Tooltip title={expanded ? t('code_block.collapse') : t('code_block.expand')}>
      <CodeBlockStickyTool onClick={onClick}>
        {expanded ? <ShrinkOutlined /> : <ExpandAltOutlined />}
      </CodeBlockStickyTool>
    </Tooltip>
  )
}

const UnwrapButton: React.FC<{ unwrapped: boolean; onClick: () => void }> = ({ unwrapped, onClick }) => {
  const { t } = useTranslation()
  return (
    <Tooltip title={unwrapped ? t('code_block.wrap.enable') : t('code_block.wrap.disable')}>
      <CodeBlockStickyTool onClick={onClick}>
        {unwrapped ? (
          <WrapIcon style={{ width: '100%', height: '100%' }} />
        ) : (
          <UnWrapIcon style={{ width: '100%', height: '100%' }} />
        )}
      </CodeBlockStickyTool>
    </Tooltip>
  )
}

const CopyButton: React.FC<{ text: string; style?: React.CSSProperties }> = ({ text, style }) => {
  const [copied, setCopied] = useState(false)
  const { t } = useTranslation()

  const onCopy = () => {
    if (!text) return
    navigator.clipboard.writeText(text)
    window.message.success({ content: t('code_block.copy.success'), key: 'copy-code' })
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Tooltip title={t('code_block.copy')}>
      <CodeBlockStickyTool>
        {copied ? (
          <CheckOutlined style={{ color: 'var(--color-primary)', ...style }} />
        ) : (
          <CopyIcon className="copy" style={style} onClick={onCopy} />
        )}
      </CodeBlockStickyTool>
    </Tooltip>
  )
}

const CodeBlockWrapper = styled.div`
  position: relative;
`

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
const CodeHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--color-text);
  font-size: 14px;
  font-weight: bold;
  height: 34px;
  padding: 0 10px;
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
  .copy {
    cursor: pointer;
    color: var(--color-text-3);
    transition: color 0.3s;
  }
  .copy:hover {
    color: var(--color-text-1);
  }
`

const CodeLanguage = styled.div`
  font-weight: bold;
`

const CodeBlockStickyTool = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text-3);
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--color-background-soft);
    color: var(--color-text-1);
  }
`

const StickyWrapper = styled.div`
  position: sticky;
  top: 28px;
  z-index: 10;
`

export default memo(CodeBlock)
