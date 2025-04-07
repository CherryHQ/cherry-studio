import { CheckOutlined, DownloadOutlined, MenuOutlined } from '@ant-design/icons'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { HStack } from '@renderer/components/Layout'
import { extractTitle } from '@renderer/utils/formats'
import { Dropdown, Tooltip } from 'antd'
import dayjs from 'dayjs'
import React, { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import CodeView from './CodeView'
import MermaidView from './MermaidView'
import { isValidPlantUML, PlantUmlView } from './PlantUmlView'
import SvgView from './SvgView'

interface Props {
  children: string
  className?: string
  [key: string]: any
}

const CodeBlock: React.FC<Props> = ({ children, className }) => {
  const match = /language-(\w+)/.exec(className || '') || children?.includes('\n')
  const language = match?.[1] ?? 'text'
  const { t } = useTranslation()

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

  const renderHeader = useMemo(() => {
    if (language === 'mermaid') {
      return <CodeHeader />
    }

    return <CodeHeader>{'<' + language.toUpperCase() + '>'}</CodeHeader>
  }, [language])

  const renderContent = useMemo(() => {
    if (language === 'mermaid') {
      return <MermaidView>{children}</MermaidView>
    }

    if (language === 'plantuml' && isValidPlantUML(children)) {
      return <PlantUmlView>{children}</PlantUmlView>
    }

    if (language === 'svg') {
      return <SvgView>{children}</SvgView>
    }

    return match ? <CodeView language={language}>{children}</CodeView> : <code className={className}>{children}</code>
  }, [children, language, className, match])

  return (
    <CodeBlockWrapper className="code-block">
      {renderHeader}
      <StickyWrapper>
        <HStack
          position="absolute"
          gap={12}
          alignItems="center"
          style={{ bottom: '0.2rem', right: '1rem', height: '27px' }}>
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
      {renderContent}
    </CodeBlockWrapper>
  )
}

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
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
          <CheckOutlined style={{ color: 'var(--color-primary)' }} />
        ) : (
          <CopyIcon className="copy" onClick={onCopy} />
        )}
      </CodeBlockStickyTool>
    </Tooltip>
  )
}

const CodeBlockWrapper = styled.div`
  position: relative;
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
