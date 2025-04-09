import { CodeOutlined, CopyOutlined, DownloadOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons'
import CodeEditor from '@renderer/components/CodeEditor'
import { ToolbarProvider, useToolbar } from '@renderer/components/CodeView/context'
import { useSettings } from '@renderer/hooks/useSettings'
import { extractTitle } from '@renderer/utils/formats'
import dayjs from 'dayjs'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

import HtmlStatusBar from './HtmlStatusBar'
import MermaidPreview from './MermaidPreview'
import PlantUmlPreview, { isValidPlantUML } from './PlantUmlPreview'
import SourcePreview from './SourcePreview'
import SvgPreview from './SvgPreview'
import Toolbar from './Toolbar'

interface Props {
  children: string
  language: string
}

/**
 * 代码块视图，支持多种语言代码块渲染
 * 提供两个放工具的位置：
 * - 顶部 sticky tool bar
 * - 底部 status bar
 */
const CodeViewImpl: React.FC<Props> = ({ children, language }) => {
  const hasSpecialView = ['mermaid', 'plantuml', 'svg'].includes(language)
  const { codeEditor } = useSettings()
  const [isInSourceView, setIsInSourceView] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  const isInSpecialView = useMemo(() => {
    return hasSpecialView && !isInSourceView
  }, [hasSpecialView, isInSourceView])

  const { updateContext, registerTool, removeTool } = useToolbar()

  useEffect(() => {
    updateContext({
      code: children,
      language,
      viewType: isInSourceView ? 'source' : language,
      viewRef: previewRef
    })
  }, [children, language, isInSourceView, updateContext])

  const onCopySource = useCallback(() => {
    if (!children) return
    navigator.clipboard.writeText(children)
    window.message.success({ content: t('code_block.copy.success'), key: 'copy-code' })
  }, [children, t])

  const onDownloadSource = useCallback(() => {
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
      icon: <CopyOutlined />,
      tooltip: t('code_block.copy.source'),
      onClick: onCopySource,
      order: 0
    })

    // 下载按钮
    registerTool({
      id: 'download',
      type: 'core',
      icon: <DownloadOutlined />,
      tooltip: t('code_block.download.source'),
      onClick: onDownloadSource,
      order: 1
    })
    return () => {
      removeTool('copy')
      removeTool('download')
    }
  }, [onCopySource, onDownloadSource, registerTool, removeTool, t])

  // 特殊视图的编辑按钮
  useEffect(() => {
    if (hasSpecialView) {
      if (codeEditor.enabled) {
        registerTool({
          id: 'edit',
          type: 'core',
          icon: isInSourceView ? <EyeOutlined /> : <EditOutlined />,
          tooltip: isInSourceView ? t('code_block.edit.off') : t('code_block.edit.on'),
          onClick: () => setIsInSourceView(!isInSourceView),
          order: 2
        })
      } else {
        registerTool({
          id: 'view-source',
          type: 'core',
          icon: isInSourceView ? <EyeOutlined /> : <CodeOutlined />,
          tooltip: isInSourceView ? t('code_block.preview') : t('code_block.preview.source'),
          onClick: () => setIsInSourceView(!isInSourceView),
          order: 2
        })
      }
    }

    return () => {
      if (hasSpecialView) {
        if (codeEditor.enabled) {
          removeTool('edit')
        } else {
          removeTool('view-source')
        }
      }
    }
  }, [codeEditor.enabled, hasSpecialView, isInSourceView, registerTool, removeTool, t])

  const SourceViewer = useMemo(() => {
    return codeEditor.enabled ? CodeEditor : SourcePreview
  }, [codeEditor.enabled])

  const renderHeader = useMemo(() => {
    if (isInSpecialView) {
      return null
    }
    return <CodeHeader>{'<' + language.toUpperCase() + '>'}</CodeHeader>
  }, [isInSpecialView, language])

  const renderContent = useMemo(() => {
    if (isInSourceView) {
      return (
        <SourceViewer language={language} ref={previewRef}>
          {children}
        </SourceViewer>
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
      <SourceViewer language={language} ref={previewRef}>
        {children}
      </SourceViewer>
    )
  }, [SourceViewer, children, isInSourceView, language])

  const renderBottomTools = useMemo(() => {
    if (language === 'html') {
      return <HtmlStatusBar html={children} />
    }
    return null
  }, [children, language])

  return (
    <CodeBlockWrapper className="code-block" isInSpecialView={isInSpecialView}>
      {renderHeader}
      <Toolbar />
      {renderContent}
      {renderBottomTools}
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

const CodeBlockWrapper = styled.div<{ isInSpecialView: boolean }>`
  position: relative;

  ${({ isInSpecialView }) =>
    isInSpecialView &&
    css`
      .toolbar {
        opacity: 0;
        transition: opacity 0.2s ease;
        transform: translateZ(0);
        will-change: opacity;
        &.show {
          opacity: 1;
        }
      }
      &:hover {
        .toolbar {
          opacity: 1;
        }
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
`

export default memo(CodeView)
