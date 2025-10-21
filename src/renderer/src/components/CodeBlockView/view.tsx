import { CodeEditor, type CodeEditorHandles } from '@cherrystudio/ui'
import { useMultiplePreferences, usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import type { ActionTool } from '@renderer/components/ActionTools'
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
import type { BasicPreviewHandles } from '@renderer/components/Preview'
import { MAX_COLLAPSED_CODE_HEIGHT } from '@renderer/config/constant'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { pyodideService } from '@renderer/services/PyodideService'
import { getExtensionByLanguage } from '@renderer/utils/code-language'
import { extractHtmlTitle, getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import dayjs from 'dayjs'
import React, { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

import { useMermaidFixTool } from '../CodeToolbar/hooks/useMermaidFixTool'
import { SPECIAL_VIEW_COMPONENTS, SPECIAL_VIEWS } from './constants'
import StatusBar from './StatusBar'
import type { ViewMode } from './types'

const logger = loggerService.withContext('CodeBlockView')

interface Props {
  // FIXME: It's not runtime string!
  children: string
  language: string
  // Message Block ID
  blockId: string
  onSave: (newContent: string) => void
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
export const CodeBlockView: React.FC<Props> = memo(({ children: code, language, blockId, onSave }) => {
  const { t } = useTranslation()

  const [codeExecutionEnabled] = usePreference('chat.code.execution.enabled')
  const [codeExecutionTimeoutMinutes] = usePreference('chat.code.execution.timeout_minutes')
  const [codeCollapsible] = usePreference('chat.code.collapsible')
  const [codeWrappable] = usePreference('chat.code.wrappable')
  const [codeImageTools] = usePreference('chat.code.image_tools')
  const [fontSize] = usePreference('chat.message.font_size')
  const [codeShowLineNumbers] = usePreference('chat.code.show_line_numbers')
  const [codeEditor] = useMultiplePreferences({
    enabled: 'chat.code.editor.enabled',
    autocompletion: 'chat.code.editor.autocompletion',
    foldGutter: 'chat.code.editor.fold_gutter',
    highlightActiveLine: 'chat.code.editor.highlight_active_line',
    keymap: 'chat.code.editor.keymap',
    themeLight: 'chat.code.editor.theme_light',
    themeDark: 'chat.code.editor.theme_dark'
  })

  const { activeCmTheme } = useCodeStyle()

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
    return codeExecutionEnabled && language === 'python'
  }, [codeExecutionEnabled, language])

  const sourceViewRef = useRef<CodeEditorHandles>(null)
  const specialViewRef = useRef<BasicPreviewHandles>(null)

  const hasSpecialView = useMemo(() => SPECIAL_VIEWS.includes(language), [language])
  const [error, setError] = useState<unknown>(null)
  const isMermaid = language === 'mermaid'

  const isInSpecialView = useMemo(() => {
    return hasSpecialView && viewMode === 'special'
  }, [hasSpecialView, viewMode])

  const [expandOverride, setExpandOverride] = useState(!codeCollapsible)
  const [wrapOverride, setWrapOverride] = useState(codeWrappable)

  // 重置用户操作
  useEffect(() => {
    setExpandOverride(!codeCollapsible)
  }, [codeCollapsible])

  // 重置用户操作
  useEffect(() => {
    setWrapOverride(codeWrappable)
  }, [codeWrappable])

  const shouldExpand = useMemo(() => !codeCollapsible || expandOverride, [codeCollapsible, expandOverride])
  const shouldWrap = useMemo(() => codeWrappable && wrapOverride, [codeWrappable, wrapOverride])

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
    navigator.clipboard.writeText(code)
    window.toast.success(t('code_block.copy.success'))
  }, [code, t])

  const handleDownloadSource = useCallback(() => {
    let fileName = ''

    // 尝试提取 HTML 标题
    if (language === 'html') {
      fileName = getFileNameFromHtmlTitle(extractHtmlTitle(code)) || ''
    }

    // 默认使用日期格式命名
    if (!fileName) {
      fileName = `${dayjs().format('YYYYMMDDHHmm')}`
    }

    const ext = getExtensionByLanguage(language)
    window.api.file.save(`${fileName}${ext}`, code)
  }, [code, language])

  const handleRunScript = useCallback(() => {
    setIsRunning(true)
    setExecutionResult(null)

    pyodideService
      .runScript(code, {}, codeExecutionTimeoutMinutes * 60000)
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
  }, [code, codeExecutionTimeoutMinutes])

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
    wrapped: shouldWrap,
    wrappable: codeWrappable,
    toggle: useCallback(() => setWrapOverride((prev) => !prev), []),
    setTools
  })

  // 代码编辑器的保存按钮
  useSaveTool({
    enabled: codeEditor.enabled && !isInSpecialView,
    sourceViewRef,
    setTools
  })

  // Mermaid fix tool
  useMermaidFixTool({
    enabled: isMermaid && error !== undefined && error !== null,
    context: {
      blockId,
      error,
      content: code
    },
    setError,
    onSave,
    setTools
  })

  // 源代码视图组件
  const sourceView = useMemo(
    () =>
      codeEditor.enabled ? (
        <CodeEditor
          className="source-view"
          ref={sourceViewRef}
          theme={activeCmTheme}
          fontSize={fontSize - 1}
          value={code}
          language={language}
          onSave={onSave}
          onHeightChange={handleHeightChange}
          maxHeight={`${MAX_COLLAPSED_CODE_HEIGHT}px`}
          options={{ stream: true, lineNumbers: codeShowLineNumbers, ...codeEditor }}
          expanded={shouldExpand}
          wrapped={shouldWrap}
        />
      ) : (
        <CodeViewer
          className="source-view"
          value={code}
          language={language}
          onHeightChange={handleHeightChange}
          expanded={shouldExpand}
          wrapped={shouldWrap}
          maxHeight={`${MAX_COLLAPSED_CODE_HEIGHT}px`}
        />
      ),
    [
      activeCmTheme,
      code,
      codeEditor,
      codeShowLineNumbers,
      fontSize,
      handleHeightChange,
      language,
      onSave,
      shouldExpand,
      shouldWrap
    ]
  )

  // 特殊视图组件映射
  const specialView = useMemo(() => {
    const SpecialView = SPECIAL_VIEW_COMPONENTS[language as keyof typeof SPECIAL_VIEW_COMPONENTS]

    if (!SpecialView) return null

    return (
      <SpecialView ref={specialViewRef} enableToolbar={codeImageTools} onError={setError}>
        {code}
      </SpecialView>
    )
  }, [code, codeImageTools, language])

  const renderHeader = useMemo(() => {
    const langTag = '<' + language.toUpperCase() + '>'
    return <CodeHeader $isInSpecialView={isInSpecialView}>{isInSpecialView ? '' : langTag}</CodeHeader>
  }, [isInSpecialView, language])

  // 根据视图模式和语言选择组件，优先展示特殊视图，fallback是源代码视图
  const renderContent = useMemo(() => {
    const showSpecialView = !!specialView && ['special', 'split'].includes(viewMode)
    const showSourceView = !specialView || viewMode !== 'special'

    return (
      <SplitViewWrapper
        className="split-view-wrapper"
        $isSpecialView={showSpecialView && !showSourceView}
        $isSplitView={showSpecialView && showSourceView}>
        {showSpecialView && specialView}
        {showSourceView && sourceView}
      </SplitViewWrapper>
    )
  }, [specialView, sourceView, viewMode])

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
  min-width: 35ch;

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

const CodeHeader = styled.div<{ $isInSpecialView?: boolean }>`
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

const SplitViewWrapper = styled.div<{ $isSpecialView: boolean; $isSplitView: boolean }>`
  display: flex;

  > * {
    flex: 1 1 auto;
    width: 100%;
  }

  &:not(:has(+ [class*='Container'])) {
    // 特殊视图的 header 会隐藏，所以全都使用圆角
    border-radius: ${(props) => (props.$isSpecialView ? '8px' : '0 0 8px 8px')};
    // FIXME: 滚动条边缘会溢出，可以考虑增加 padding，但是要保证代码主题颜色铺满容器。
    // overflow: hidden;
    .code-viewer {
      border-radius: inherit;
    }
  }

  // 在 split 模式下添加中间分隔线
  ${(props) =>
    props.$isSplitView &&
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
