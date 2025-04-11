import {
  BorderOutlined,
  DownloadOutlined,
  EditOutlined,
  ExpandOutlined,
  EyeOutlined,
  LinkOutlined,
  LoadingOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'
import { ToolbarProvider, ToolContext, useToolbar } from '@renderer/components/CodeView/context'
import { useSettings } from '@renderer/hooks/useSettings'
import { formatPyodideResult, runPythonScript } from '@renderer/services/PyodideService'
import { extractTitle } from '@renderer/utils/formats'
import dayjs from 'dayjs'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

import { CodeXmlIcon } from '../Icons/CodeXmlIcon'
import { SplitHorizontalIcon } from '../Icons/SplitIcons'
import MermaidPreview from './MermaidPreview'
import PlantUmlPreview, { isValidPlantUML } from './PlantUmlPreview'
import SourceEditor from './SourceEditor'
import SourcePreview from './SourcePreview'
import StatusBar from './StatusBar'
import SvgPreview from './SvgPreview'
import Toolbar from './Toolbar'
import { useHtmlHandlers } from './useHtmlTools'

type ViewMode = 'source' | 'special' | 'split'

interface Props {
  children: string
  language: string
  onSave?: (newContent: string) => void
}

/**
 * 代码块视图
 *
 * 视图类型：
 * - preview: 预览视图，其中非源代码的是特殊视图
 * - edit: 编辑视图
 *
 * 视图模式：
 * - source: 源代码视图模式
 * - special: 特殊视图模式（Mermaid、PlantUML、SVG）
 * - split: 分屏模式（源代码和特殊视图并排显示）
 *
 * 顶部 sticky 工具栏：
 * - quick 工具
 * - core 工具
 */
const CodeViewImpl: React.FC<Props> = ({ children, language, onSave }) => {
  const { t } = useTranslation()
  const { codeEditor } = useSettings()
  const previewRef = useRef<HTMLDivElement>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('special')
  const [isRunning, setIsRunning] = useState(false)
  const [output, setOutput] = useState('')

  const isExecutable = useMemo(() => language === 'python', [language])
  const hasSpecialView = ['mermaid', 'plantuml', 'svg'].includes(language)

  const isInSpecialView = useMemo(() => {
    return hasSpecialView && viewMode === 'special'
  }, [hasSpecialView, viewMode])

  const { handleOpenInApp, handleOpenExternal } = useHtmlHandlers()

  const { updateContext, registerTool, removeTool } = useToolbar()

  useEffect(() => {
    updateContext({
      code: children,
      language
    })
  }, [children, language, updateContext])

  const handleCopySource = useCallback(
    (ctx?: ToolContext) => {
      if (!ctx) return
      navigator.clipboard.writeText(ctx.code)
      window.message.success({ content: t('code_block.copy.success'), key: 'copy-code' })
    },
    [t]
  )

  const handleDownloadSource = useCallback((ctx?: ToolContext) => {
    if (!ctx) return

    const { code, language } = ctx
    let fileName = ''

    // 尝试提取标题
    if (language === 'html' && code.includes('</html>')) {
      const title = extractTitle(code)
      if (title) {
        fileName = `${title}.html`
      }
    }

    // 默认使用日期格式命名
    if (!fileName) {
      fileName = `${dayjs().format('YYYYMMDDHHmm')}.${language}`
    }

    window.api.file.save(fileName, code)
  }, [])

  const handleRunScript = useCallback((ctx?: ToolContext) => {
    if (!ctx) return

    setIsRunning(true)
    setOutput('')

    runPythonScript(ctx.code, {})
      .then((output) => {
        console.log('Python execution result:', output)

        // 统一构建输出文本
        let outputText = ''

        // 1. 优先显示标准输出文本
        if (output.text) {
          outputText = output.text
        }
        // 2. 如果没有标准输出但有结果值，显示结果
        else if (output.result !== null && output.result !== undefined) {
          outputText = formatPyodideResult(output.result)
        }

        // 3. 如果有错误信息，附加显示（无论是否有其他输出）
        if (output.error) {
          if (outputText) outputText += '\n\n'
          outputText += output.error
        }

        setOutput(outputText || '(no output)')
      })
      .catch((error) => {
        // 这里只处理系统级错误（如网络问题、Worker崩溃等）
        // Python执行错误已由Worker捕获并通过output.error字段返回
        console.error('System error:', error)
        setOutput(`System error:\n${error.message || 'Unknown error'}`)
      })
      .finally(() => {
        setIsRunning(false)
      })
  }, [])

  useEffect(() => {
    // 复制按钮
    registerTool({
      id: 'copy',
      type: 'core',
      icon: <i className="iconfont icon-copy" style={{ fontSize: 14 }}></i>,
      tooltip: t('code_block.copy.source'),
      onClick: handleCopySource,
      order: 0
    })

    // 下载按钮
    registerTool({
      id: 'download',
      type: 'core',
      icon: <DownloadOutlined />,
      tooltip: t('code_block.download.source'),
      onClick: handleDownloadSource,
      order: 1
    })
    return () => {
      removeTool('copy')
      removeTool('download')
    }
  }, [handleCopySource, handleDownloadSource, registerTool, removeTool, t])

  // 特殊视图的编辑按钮，在分屏模式下不可用
  useEffect(() => {
    if (!hasSpecialView || viewMode === 'split') return

    if (codeEditor.enabled) {
      registerTool({
        id: 'edit',
        type: 'core',
        icon: viewMode === 'source' ? <EyeOutlined /> : <EditOutlined />,
        tooltip: viewMode === 'source' ? t('code_block.preview') : t('code_block.edit'),
        onClick: () => setViewMode(viewMode === 'source' ? 'special' : 'source'),
        order: 2
      })
    } else {
      registerTool({
        id: 'view-source',
        type: 'core',
        icon: viewMode === 'source' ? <EyeOutlined /> : <CodeXmlIcon />,
        tooltip: viewMode === 'source' ? t('code_block.preview') : t('code_block.preview.source'),
        onClick: () => setViewMode(viewMode === 'source' ? 'special' : 'source'),
        order: 2
      })
    }

    return () => {
      removeTool(codeEditor.enabled ? 'edit' : 'view-source')
    }
  }, [codeEditor.enabled, hasSpecialView, viewMode, registerTool, removeTool, t])

  // 特殊视图的分屏按钮
  useEffect(() => {
    if (!hasSpecialView) return

    registerTool({
      id: 'split-view-horizontal',
      type: 'quick',
      icon: viewMode === 'split' ? <BorderOutlined /> : <SplitHorizontalIcon />,
      tooltip: viewMode === 'split' ? t('code_block.split.restore') : t('code_block.split'),
      onClick: () => setViewMode(viewMode === 'split' ? 'special' : 'split'),
      order: 1
    })

    return () => removeTool('split-view-horizontal')
  }, [hasSpecialView, viewMode, registerTool, removeTool, t])

  // 运行按钮
  useEffect(() => {
    if (!isExecutable) return

    registerTool({
      id: 'run',
      type: 'quick',
      icon: isRunning ? <LoadingOutlined /> : <PlayCircleOutlined />,
      tooltip: t('code_block.run'),
      onClick: (ctx) => !isRunning && handleRunScript(ctx),
      order: 10
    })

    return () => isExecutable && removeTool('run')
  }, [isExecutable, isRunning, handleRunScript, registerTool, removeTool, t])

  // HTML 打开按钮
  useEffect(() => {
    if (language !== 'html') return

    registerTool({
      id: 'html-open-in-app',
      type: 'quick',
      icon: <ExpandOutlined />,
      tooltip: t('chat.artifacts.button.preview'),
      onClick: handleOpenInApp,
      order: 21
    })

    registerTool({
      id: 'html-open-external',
      type: 'quick',
      icon: <LinkOutlined />,
      tooltip: t('chat.artifacts.button.openExternal'),
      onClick: handleOpenExternal,
      order: 20
    })

    return () => {
      removeTool('html-open-in-app')
      removeTool('html-open-external')
    }
  }, [handleOpenExternal, handleOpenInApp, language, registerTool, removeTool, t])

  // 源代码视图组件
  const sourceView = useMemo(() => {
    const SourceView = codeEditor.enabled ? SourceEditor : SourcePreview
    return (
      <SourceView ref={previewRef} language={language} onSave={onSave}>
        {children}
      </SourceView>
    )
  }, [children, codeEditor.enabled, language, onSave])

  // 特殊视图组件映射
  const specialViewMap: Record<string, React.ReactNode> = useMemo(() => {
    return {
      mermaid: <MermaidPreview>{children}</MermaidPreview>,
      plantuml: isValidPlantUML(children) ? <PlantUmlPreview>{children}</PlantUmlPreview> : null,
      svg: <SvgPreview>{children}</SvgPreview>
    }
  }, [children])

  const renderHeader = useMemo(() => {
    if (isInSpecialView) {
      return null
    }
    return <CodeHeader>{'<' + language.toUpperCase() + '>'}</CodeHeader>
  }, [isInSpecialView, language])

  // 根据视图模式和语言选择组件，优先展示特殊视图，fallback是源代码视图
  const renderContent = useMemo(() => {
    const specialView = specialViewMap[language]

    if (viewMode === 'special' && specialView) {
      return specialView
    }

    if (viewMode === 'split' && specialView) {
      return (
        <SplitViewWrapper className="split-view-wrapper">
          {specialView}
          {sourceView}
        </SplitViewWrapper>
      )
    }

    return sourceView
  }, [language, sourceView, specialViewMap, viewMode])

  return (
    <CodeBlockWrapper className="code-block" isInSpecialView={isInSpecialView}>
      {renderHeader}
      <Toolbar />
      {renderContent}
      {isExecutable && output && <StatusBar>{output}</StatusBar>}
    </CodeBlockWrapper>
  )
}

const CodeView: React.FC<Props> = ({ children, language, onSave }) => {
  return (
    <ToolbarProvider>
      <CodeViewImpl children={children} language={language} onSave={onSave} />
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
        margin-top: 20px;
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

const SplitViewWrapper = styled.div`
  display: table;
  width: 100%;
  table-layout: fixed;

  > * {
    display: table-cell;
    vertical-align: top;
    width: 50%;
  }
`

export default memo(CodeView)
