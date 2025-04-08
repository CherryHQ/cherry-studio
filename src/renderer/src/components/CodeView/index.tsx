import { DownloadOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons'
import { ToolbarProvider, useToolbar } from '@renderer/components/CodeView/context'
import CopyIcon from '@renderer/components/Icons/CopyIcon'
import { extractTitle } from '@renderer/utils/formats'
import dayjs from 'dayjs'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import MermaidPreview from './MermaidPreview'
import PlantUmlPreview, { isValidPlantUML } from './PlantUmlPreview'
import SourcePreview from './SourcePreview'
import SvgPreview from './SvgPreview'
import Toolbar from './Toolbar'

interface Props {
  children: string
  language: string
}

const CodeViewImpl: React.FC<Props> = ({ children, language }) => {
  const hasSpecialView = ['mermaid', 'plantuml', 'svg'].includes(language)
  const [isEditing, setIsEditing] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  const { updateContext, registerTool, removeTool } = useToolbar()

  useEffect(() => {
    updateContext({
      code: children,
      language,
      previewType: isEditing ? 'source' : language,
      previewRef
    })
  }, [children, language, isEditing, updateContext])

  const onCopyCode = useCallback(() => {
    if (!children) return
    navigator.clipboard.writeText(children)
    window.message.success({ content: t('code_block.copy.success'), key: 'copy-code' })
  }, [children, t])

  const onDownloadCode = useCallback(() => {
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
  }, [children, language])

  useEffect(() => {
    // 复制按钮
    registerTool({
      id: 'copy',
      type: 'core',
      icon: <CopyIcon />,
      tooltip: t('code_block.copy'),
      onClick: onCopyCode,
      order: 0
    })

    // 下载按钮
    registerTool({
      id: 'download',
      type: 'core',
      icon: <DownloadOutlined />,
      tooltip: t('code_block.download'),
      onClick: onDownloadCode,
      order: 1
    })
    return () => {
      removeTool('copy')
      removeTool('download')
    }
  }, [onCopyCode, onDownloadCode, registerTool, removeTool, t])

  // 特殊视图的编辑按钮
  useEffect(() => {
    if (hasSpecialView) {
      registerTool({
        id: 'edit',
        type: 'core',
        icon: isEditing ? <EyeOutlined /> : <EditOutlined />,
        tooltip: isEditing ? t('code_block.edit.off') : t('code_block.edit.on'),
        onClick: () => setIsEditing(!isEditing),
        order: 2
      })
    }

    return () => {
      if (hasSpecialView) removeTool('edit')
    }
  }, [hasSpecialView, isEditing, registerTool, removeTool, t])

  const renderContent = useMemo(() => {
    if (isEditing) {
      return (
        <SourcePreview language={language} ref={previewRef}>
          {children}
        </SourcePreview>
      )
    }

    if (language === 'mermaid') {
      return <MermaidPreview>{children}</MermaidPreview>
    }

    if (language === 'plantuml' && isValidPlantUML(children)) {
      return <PlantUmlPreview>{children}</PlantUmlPreview>
    }

    if (language === 'svg') {
      return <SvgPreview>{children}</SvgPreview>
    }

    return (
      <SourcePreview language={language} ref={previewRef}>
        {children}
      </SourcePreview>
    )
  }, [children, isEditing, language])

  return (
    <CodeBlockWrapper className="code-block">
      <CodeHeader>{'<' + language.toUpperCase() + '>'}</CodeHeader>
      <Toolbar />
      {renderContent}
    </CodeBlockWrapper>
  )
}

const CodeView: React.FC<Props> = ({ children, language }) => {
  return (
    <ToolbarProvider>
      <CodeViewImpl children={children} language={language} />
    </ToolbarProvider>
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

export default memo(CodeView)
