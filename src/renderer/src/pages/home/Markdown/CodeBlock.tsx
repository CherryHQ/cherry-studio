import { CheckOutlined, DownloadOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { HStack } from '@renderer/components/Layout'
import { extractTitle } from '@renderer/utils/formats'
import { Tooltip } from 'antd'
import dayjs from 'dayjs'
import React, { memo, useMemo, useState } from 'react'
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
  const hasSpecialView = ['mermaid', 'plantuml', 'svg'].includes(language)

  const [isEditing, setIsEditing] = useState(false)

  const renderContent = useMemo(() => {
    if (isEditing) {
      return <CodeView language={language}>{children}</CodeView>
    }

    if (language === 'mermaid') {
      return <MermaidView>{children}</MermaidView>
    }

    if (language === 'plantuml' && isValidPlantUML(children)) {
      return <PlantUmlView>{children}</PlantUmlView>
    }

    if (language === 'svg') {
      return <SvgView>{children}</SvgView>
    }

    return <CodeView language={language}>{children}</CodeView>
  }, [children, isEditing, language])

  return match ? (
    <CodeBlockWrapper className="code-block">
      <CodeHeader>{'<' + language.toUpperCase() + '>'}</CodeHeader>
      <StickyWrapper>
        <CodeToolWrapper>
          {hasSpecialView && <EditButton isEditing={isEditing} setIsEditing={setIsEditing} />}
          <DownloadButton text={children} language={language} />
          <CopyButton text={children} />
        </CodeToolWrapper>
      </StickyWrapper>
      {renderContent}
    </CodeBlockWrapper>
  ) : (
    <code className={className} style={{ textWrap: 'wrap' }}>
      {children}
    </code>
  )
}

const EditButton: React.FC<{ isEditing: boolean; setIsEditing: (isEditing: boolean) => void }> = ({
  isEditing,
  setIsEditing
}) => {
  const { t } = useTranslation()

  return (
    <Tooltip title={isEditing ? t('code_block.edit.off') : t('code_block.edit.on')}>
      <CodeBlockStickyTool onClick={() => setIsEditing(!isEditing)}>
        {isEditing ? <EyeOutlined /> : <EditOutlined />}
      </CodeBlockStickyTool>
    </Tooltip>
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

const DownloadButton: React.FC<{ text: string; language: string }> = ({ text, language }) => {
  const { t } = useTranslation()

  const onDownload = () => {
    let fileName = ''

    // 尝试提取标题
    if (language === 'html' && text.includes('</html>')) {
      const title = extractTitle(text)
      if (title) {
        fileName = `${title}.html`
      }
    }

    // 默认使用日期格式命名
    if (!fileName) {
      fileName = `${dayjs().format('YYYYMMDDHHmm')}.${language}`
    }

    window.api.file.save(fileName, text)
  }

  return (
    <Tooltip title={t('code_block.download')}>
      <CodeBlockStickyTool onClick={onDownload}>
        <DownloadOutlined />
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

const CodeToolWrapper = styled(HStack)`
  position: absolute;
  align-items: center;
  bottom: 0.2rem;
  right: 1rem;
  height: 27px;
  gap: 12px;
`

export default memo(CodeBlock)
