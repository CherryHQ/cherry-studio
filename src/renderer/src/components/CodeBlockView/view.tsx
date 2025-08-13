import { loggerService } from '@logger'
import { ActionTool } from '@renderer/components/ActionTools'
import CodeEditor, { CodeEditorHandles } from '@renderer/components/CodeEditor'
import {
  CodeToolbar,
  useCopyTool,
  useDownloadTool,
  useExpandTool,
  useRunTool,
  useSaveTool,
  useSplitViewTool,
  useViewSourceTool,
  useWrapTool
} from '@renderer/components/CodeToolbar'
import CodeViewer from '@renderer/components/CodeViewer'
import ImageViewer from '@renderer/components/ImageViewer'
import { BasicPreviewHandles } from '@renderer/components/Preview'
import { MAX_COLLAPSED_CODE_HEIGHT } from '@renderer/config/constant'
import { useSettings } from '@renderer/hooks/useSettings'
import { pyodideService } from '@renderer/services/PyodideService'
import { extractTitle } from '@renderer/utils/formats'
import { getExtensionByLanguage, isHtmlCode } from '@renderer/utils/markdown'
import dayjs from 'dayjs'
import React, { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

import { SPECIAL_VIEW_COMPONENTS, SPECIAL_VIEWS } from './constants'
import HtmlArtifactsCard from './HtmlArtifactsCard'
import StatusBar from './StatusBar'
import { ViewMode } from './types'

const logger = loggerService.withContext('CodeBlockView')

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
export const CodeBlockView: React.FC<Props> = memo(({ children, language, onSave }) => {
  const { t } = useTranslation()
  const { codeEditor, codeExecution, codeImageTools, codeCollapsible, codeWrappable } = useSettings()

  const [viewState, setViewState] = useState({
    mode: 'special' as ViewMode,
    previousMode: 'special' as ViewMode
  })
  const { mode: viewMode } = viewState

  const setViewMode = useCallback((newMode: ViewMode) => {
    setViewState((current) => ({
      mode: newMode,
      // 当新模式不是 'split' 时才更新
      previousMode: newMode !== 'split' ? newMode : current.previousMode
    }))
  }, [])

  const toggleSplitView = useCallback(() => {
    setViewState((current) => {
      // 如果当前是 split 模式，恢复到上一个模式
      if (current.mode === 'split') {
        return { ...current, mode: current.previousMode }
      }
      return { mode: 'split', previousMode: current.mode }
    })
  }, [])

  const [isRunning, setIsRunning] = useState(false)
  const [executionResult, setExecutionResult] = useState<{ text: string; image?: string } | null>(null)

  const [tools, setTools] = useState<ActionTool[]>([])

  const isExecutable = useMemo(() => {
    return codeExecution.enabled && language === 'python'
  }, [codeExecution.enabled, language])

  const sourceViewRef = useRef<CodeEditorHandles>(null)
  const specialViewRef = useRef<BasicPreviewHandles>(null)

  const hasSpecialView = useMemo(() => SPECIAL_VIEWS.includes(language), [language])

  const isInSpecialView = useMemo(() => {
    return hasSpecialView && viewMode === 'special'
  }, [hasSpecialView, viewMode])

  const [expandOverride, setExpandOverride] = useState(!codeCollapsible)
  const [unwrapOverride, setUnwrapOverride] = useState(!codeWrappable)

  // 重置用户操作
  useEffect(() => {
    setExpandOverride(!codeCollapsible)
  }, [codeCollapsible])

  // 重置用户操作
  useEffect(() => {
    setUnwrapOverride(!codeWrappable)
  }, [codeWrappable])

  const shouldExpand = useMemo(() => !codeCollapsible || expandOverride, [codeCollapsible, expandOverride])
  const shouldUnwrap = useMemo(() => !codeWrappable || unwrapOverride, [codeWrappable, unwrapOverride])

  const [sourceScrollHeight, setSourceScrollHeight] = useState(0)
  const expandable = useMemo(() => {
    return codeCollapsible && sourceScrollHeight > MAX_COLLAPSED_CODE_HEIGHT
  }, [codeCollapsible, sourceScrollHeight])

  const handleHeightChange = useCallback((height: number) => {
    startTransition(() => {
      setSourceScrollHeight((prev) => (prev === height ? prev : height))
    })
  }, [])

  const handleCopySource = useCallback(() => {
    navigator.clipboard.writeText(children)
    window.message.success({ content: t('code_block.copy.success'), key: 'copy-code' })
  }, [children, t])

  const handleDownloadSource = useCallback(() => {
    let fileName = ''

    // 尝试提取 HTML 标题
    if (language === 'html' && children.includes('</html>')) {
      fileName = extractTitle(children) || ''
    }

    // 默认使用日期格式命名
    if (!fileName) {
      fileName = `${dayjs().format('YYYYMMDDHHmm')}`
    }

    const ext = getExtensionByLanguage(language)
    window.api.file.save(`${fileName}${ext}`, children)
  }, [children, language])

  const handleRunScript = useCallback(() => {
    setIsRunning(true)
    setExecutionResult(null)

    pyodideService
      .runScript(children, {}, codeExecution.timeoutMinutes * 60000)
      .then((result) => {
        setExecutionResult(result)
      })
      .catch((error) => {
        logger.error('Unexpected error:', error)
        setExecutionResult({
          text: `Unexpected error: ${error.message || 'Unknown error'}`
        })
      })
      .finally(() => {
        setIsRunning(false)
      })
  }, [children, codeExecution.timeoutMinutes])

  const showPreviewTools = useMemo(() => {
    return viewMode !== 'source' && hasSpecialView
  }, [hasSpecialView, viewMode])

  // 复制按钮
  useCopyTool({
    showPreviewTools,
    previewRef: specialViewRef,
    onCopySource: handleCopySource,
    setTools
  })

  // 下载按钮
  useDownloadTool({
    showPreviewTools,
    previewRef: specialViewRef,
    onDownloadSource: handleDownloadSource,
    setTools
  })

  // 特殊视图的编辑/查看源码按钮，在分屏模式下不可用
  useViewSourceTool({
    enabled: hasSpecialView,
    editable: codeEditor.enabled,
    viewMode,
    onViewModeChange: setViewMode,
    setTools
  })

  // 特殊视图存在时的分屏按钮
  useSplitViewTool({
    enabled: hasSpecialView,
    viewMode,
    onToggleSplitView: toggleSplitView,
    setTools
  })

  // 运行按钮
  useRunTool({
    enabled: isExecutable,
    isRunning,
    onRun: handleRunScript,
    setTools
  })

  // 源代码视图的展开/折叠按钮
  useExpandTool({
    enabled: !isInSpecialView,
    expanded: shouldExpand,
    expandable,
    toggle: useCallback(() => setExpandOverride((prev) => !prev), []),
    setTools
  })

  // 源代码视图的自动换行按钮
  useWrapTool({
    enabled: !isInSpecialView,
    unwrapped: shouldUnwrap,
    wrappable: codeWrappable,
    toggle: useCallback(() => setUnwrapOverride((prev) => !prev), []),
    setTools
  })

  // 代码编辑器的保存按钮
  useSaveTool({
    enabled: codeEditor.enabled && !isInSpecialView,
    sourceViewRef,
    setTools
  })

  // 源代码视图组件
  const sourceView = useMemo(
    () =>
      codeEditor.enabled ? (
        <CodeEditor
          className="source-view"
          ref={sourceViewRef}
          value={children}
          language={language}
          onSave={onSave}
          onHeightChange={handleHeightChange}
          options={{ stream: true }}
          expanded={shouldExpand}
          unwrapped={shouldUnwrap}
        />
      ) : (
        <CodeViewer
          className="source-view"
          language={language}
          expanded={shouldExpand}
          unwrapped={shouldUnwrap}
          onHeightChange={handleHeightChange}>
          {children}
        </CodeViewer>
      ),
    [children, codeEditor.enabled, handleHeightChange, language, onSave, shouldExpand, shouldUnwrap]
  )

  // 特殊视图组件映射
  const specialView = useMemo(() => {
    const SpecialView = SPECIAL_VIEW_COMPONENTS[language as keyof typeof SPECIAL_VIEW_COMPONENTS]

    if (!SpecialView) return null

    return (
      <SpecialView ref={specialViewRef} enableToolbar={codeImageTools}>
        {children}
      </SpecialView>
    )
  }, [children, codeImageTools, language])

  const renderHeader = useMemo(() => {
    const langTag = '<' + language.toUpperCase() + '>'
    return <CodeHeader $isInSpecialView={isInSpecialView}>{isInSpecialView ? '' : langTag}</CodeHeader>
  }, [isInSpecialView, language])

  // 根据视图模式和语言选择组件，优先展示特殊视图，fallback是源代码视图
  const renderContent = useMemo(() => {
    const showSpecialView = specialView && ['special', 'split'].includes(viewMode)
    const showSourceView = !specialView || viewMode !== 'special'

    return (
      <SplitViewWrapper className="split-view-wrapper" $viewMode={viewMode}>
        {showSpecialView && specialView}
        {showSourceView && sourceView}
      </SplitViewWrapper>
    )
  }, [specialView, sourceView, viewMode])

  // HTML 代码块特殊处理 - 在所有 hooks 调用之后
  if (language === 'html' && isHtmlCode(children)) {
    return <HtmlArtifactsCard html={children} />
  }

  return (
    <CodeBlockWrapper className="code-block" $isInSpecialView={isInSpecialView}>
      {renderHeader}
      <CodeToolbar tools={tools} />
      {renderContent}
      {isExecutable && executionResult && (
        <StatusBar>
          {executionResult.text}
          {executionResult.image && (
            <ImageViewer src={executionResult.image} alt="Matplotlib plot" style={{ cursor: 'pointer' }} />
          )}
        </StatusBar>
      )}
    </CodeBlockWrapper>
  )
})

const CodeBlockWrapper = styled.div<{ $isInSpecialView: boolean }>`
  position: relative;
  width: 100%;
  /* FIXME: 最小宽度用于解决两个问题。
   * 一是 CodeViewer 在气泡样式下的用户消息中无法撑开气泡，
   * 二是 代码块内容过少时 toolbar 会和 title 重叠。
   */
  min-width: 45ch;

  .code-toolbar {
    background-color: ${(props) => (props.$isInSpecialView ? 'transparent' : 'var(--color-background-mute)')};
    border-radius: ${(props) => (props.$isInSpecialView ? '0' : '4px')};
    opacity: 0;
    transition: opacity 0.2s ease;
    transform: translateZ(0);
    will-change: opacity;
    &.show {
      opacity: 1;
    }
  }
  &:hover {
    .code-toolbar {
      opacity: 1;
    }
  }
`

const CodeHeader = styled.div<{ $isInSpecialView: boolean }>`
  display: flex;
  align-items: center;
  color: var(--color-text);
  font-size: 14px;
  line-height: 1;
  font-weight: bold;
  padding: 0 10px;
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
  margin-top: ${(props) => (props.$isInSpecialView ? '6px' : '0')};
  height: ${(props) => (props.$isInSpecialView ? '16px' : '34px')};
  background-color: ${(props) => (props.$isInSpecialView ? 'transparent' : 'var(--color-background-mute)')};
`

const SplitViewWrapper = styled.div<{ $viewMode?: ViewMode }>`
  display: flex;

  > * {
    flex: 1 1 auto;
    width: 100%;
  }

  &:not(:has(+ [class*='Container'])) {
    // 特殊视图的 header 会隐藏，所以全都使用圆角
    border-radius: ${(props) => (props.$viewMode === 'special' ? '8px' : '0 0 8px 8px')};
    overflow: hidden;
  }

  // 在 split 模式下添加中间分隔线
  ${(props) =>
    props.$viewMode === 'split' &&
    css`
      position: relative;

      &:before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: 50%;
        width: 1px;
        background-color: var(--color-background-mute);
        transform: translateX(-50%);
        z-index: 1;
      }
    `}
`
