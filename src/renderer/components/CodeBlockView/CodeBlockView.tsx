import { Icon } from '@iconify/react'
import dayjs from 'dayjs'
import React, {
  memo,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

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
import type { BasicPreviewHandles } from '@renderer/components/Preview/types'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { pyodideService } from '@renderer/services/PyodideService'
import { toast } from '@renderer/services/toast'
import { getExtensionByLanguage } from '@renderer/utils/codeLanguage'
import { getFileIconName } from '@renderer/utils/fileIconName'
import { extractHtmlTitle, getFileNameFromHtmlTitle } from '@renderer/utils/formats'
import { cn } from '@renderer/utils/style'

import { MAX_COLLAPSED_CODE_HEIGHT, SPECIAL_VIEW_COMPONENTS, SPECIAL_VIEWS } from './constants'
import StatusBar from './StatusBar'
import type { ViewMode } from './types'

const logger = loggerService.withContext('CodeBlockView')
const HIGHLIGHTED_CODE_VIEWER_OPTIONS = { highlight: true } as const
const STREAMING_CODE_VIEWER_OPTIONS = { highlight: false } as const

interface Props {
  children: string
  language: string
  onSave?: (newContent: string) => void
  editable?: boolean
  isStreaming?: boolean
  showToolbar?: boolean
  maxHeight?: string | number
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
 * - edit: 编辑视图模式
 * - special: 特殊视图模式（Mermaid、PlantUML、SVG）
 * - split: 分屏模式（源代码和特殊视图并排显示）
 *
 * 顶部 sticky 工具栏：
 * - quick 工具
 * - core 工具
 */
export const CodeBlockView: React.FC<Props> = memo((props) => {
  const { children, language, onSave, editable = true, isStreaming = false, showToolbar = true, maxHeight } = props
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
  const canEdit = codeEditor.enabled && editable
  const hasSpecialView = useMemo(() => SPECIAL_VIEWS.includes(language), [language])
  const startedStreamingRef = useRef(isStreaming)

  const [viewState, setViewState] = useState({
    mode: 'special' as ViewMode,
    previousMode: 'special' as ViewMode
  })
  const viewMode = useMemo<ViewMode>(() => {
    if (viewState.mode === 'edit' && !canEdit) return 'source'
    if (!hasSpecialView && viewState.mode !== 'edit') {
      return canEdit && !startedStreamingRef.current && viewState.mode === 'special' ? 'edit' : 'source'
    }
    return viewState.mode
  }, [canEdit, hasSpecialView, viewState.mode])

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
  const latestActionContextRef = useRef({ source: children, language, t })

  useLayoutEffect(() => {
    latestActionContextRef.current = { source: children, language, t }
  }, [children, language, t])

  const isInSpecialView = useMemo(() => {
    return hasSpecialView && viewMode === 'special'
  }, [hasSpecialView, viewMode])
  const isEditing = canEdit && (viewMode === 'edit' || (viewMode === 'split' && viewState.previousMode === 'edit'))

  const [expandOverride, setExpandOverride] = useState(!codeCollapsible)
  const [wrapOverride, setWrapOverride] = useState(codeWrappable)
  const handleRequestExpand = useCallback(() => setExpandOverride(true), [])

  // 重置用户操作
  useEffect(() => {
    setExpandOverride(!codeCollapsible)
  }, [codeCollapsible])

  // 重置用户操作
  useEffect(() => {
    setWrapOverride(codeWrappable)
  }, [codeWrappable])

  const shouldExpand = useMemo(
    () => maxHeight === undefined && (!codeCollapsible || expandOverride),
    [codeCollapsible, expandOverride, maxHeight]
  )
  const shouldWrap = useMemo(() => codeWrappable && wrapOverride, [codeWrappable, wrapOverride])
  const sourceMaxHeight =
    typeof maxHeight === 'number' ? `${maxHeight}px` : (maxHeight ?? `${MAX_COLLAPSED_CODE_HEIGHT}px`)

  const [sourceScrollHeight, setSourceScrollHeight] = useState(0)
  const expandable = useMemo(() => {
    return codeCollapsible && sourceScrollHeight > MAX_COLLAPSED_CODE_HEIGHT
  }, [codeCollapsible, sourceScrollHeight])

  const handleHeightChange = useCallback((height: number) => {
    startTransition(() => {
      setSourceScrollHeight((prev) => (prev === height ? prev : height))
    })
  }, [])

  const handleCopySource = useCallback(async (): Promise<boolean> => {
    try {
      const content = sourceViewRef.current?.getContent?.() ?? latestActionContextRef.current.source
      await navigator.clipboard.writeText(content.trimEnd())
      toast.success(latestActionContextRef.current.t('code_block.copy.success'))
      return true
    } catch (error) {
      logger.error('Failed to copy to clipboard:', { error })
      toast.error(latestActionContextRef.current.t('code_block.copy.failed'))
      return false
    }
  }, [])

  const handleDownloadSource = useCallback(() => {
    const { source: currentSource, language: currentLanguage } = latestActionContextRef.current
    let fileName = ''

    // 尝试提取 HTML 标题
    if (currentLanguage === 'html') {
      fileName = getFileNameFromHtmlTitle(extractHtmlTitle(currentSource)) || ''
    }

    // 默认使用日期格式命名
    if (!fileName) {
      fileName = `${dayjs().format('YYYYMMDDHHmm')}`
    }

    const ext = getExtensionByLanguage(currentLanguage)
    void window.api.file.save(`${fileName}${ext}`, currentSource)
  }, [])

  const handleRunScript = useCallback(() => {
    const source = latestActionContextRef.current.source
    setIsRunning(true)
    setExecutionResult(null)

    pyodideService
      .runScript(source, {}, codeExecutionTimeoutMinutes * 60000)
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
  }, [codeExecutionTimeoutMinutes])

  const showPreviewTools = useMemo(() => {
    return hasSpecialView && (viewMode === 'special' || viewMode === 'split')
  }, [hasSpecialView, viewMode])

  const handleToggleExpanded = useCallback(() => setExpandOverride((current) => !current), [])
  const handleToggleWrapped = useCallback(() => setWrapOverride((current) => !current), [])

  useCopyTool({
    showPreviewTools,
    previewRef: specialViewRef,
    onCopySource: handleCopySource,
    setTools
  })

  useDownloadTool({
    showPreviewTools,
    previewRef: specialViewRef,
    onDownloadSource: handleDownloadSource,
    setTools
  })

  useViewSourceTool({
    canEdit,
    hasSpecialView,
    isStreaming,
    viewMode,
    onViewModeChange: setViewMode,
    setTools
  })

  useSplitViewTool({
    enabled: hasSpecialView,
    viewMode,
    onToggleSplitView: toggleSplitView,
    setTools
  })

  useRunTool({
    enabled: isExecutable,
    isRunning,
    onRun: handleRunScript,
    setTools
  })

  useExpandTool({
    enabled: !isInSpecialView && maxHeight === undefined,
    expanded: shouldExpand,
    expandable,
    toggle: handleToggleExpanded,
    setTools
  })

  useWrapTool({
    enabled: !isInSpecialView,
    wrapped: shouldWrap,
    wrappable: codeWrappable,
    toggle: handleToggleWrapped,
    setTools
  })

  useSaveTool({
    enabled: isEditing && !isStreaming && !isInSpecialView,
    sourceViewRef,
    setTools
  })

  const hasStatusBar = isExecutable && !!executionResult

  // 源代码视图组件
  const sourceView = useMemo(
    () =>
      isEditing ? (
        <CodeEditor
          className="source-view"
          ref={sourceViewRef}
          theme={activeCmTheme}
          fontSize={fontSize - 1}
          value={children}
          language={language}
          onSave={onSave}
          onHeightChange={handleHeightChange}
          maxHeight={sourceMaxHeight}
          options={{ stream: true, lineNumbers: codeShowLineNumbers, ...codeEditor }}
          expanded={shouldExpand}
          wrapped={shouldWrap}
          autoScrollToBottom={isStreaming && !shouldExpand}
        />
      ) : (
        <CodeViewer
          className="source-view"
          value={children}
          language={language}
          onHeightChange={handleHeightChange}
          expanded={shouldExpand}
          wrapped={shouldWrap}
          maxHeight={sourceMaxHeight}
          onRequestExpand={maxHeight === undefined && codeCollapsible ? handleRequestExpand : undefined}
          autoScrollToBottom={isStreaming && !shouldExpand}
          options={isStreaming ? STREAMING_CODE_VIEWER_OPTIONS : HIGHLIGHTED_CODE_VIEWER_OPTIONS}
        />
      ),
    [
      activeCmTheme,
      children,
      codeCollapsible,
      codeEditor,
      codeShowLineNumbers,
      fontSize,
      handleHeightChange,
      handleRequestExpand,
      isEditing,
      isStreaming,
      language,
      maxHeight,
      onSave,
      shouldExpand,
      shouldWrap,
      sourceMaxHeight
    ]
  )

  // 特殊视图组件映射
  const specialView = useMemo(() => {
    const SpecialView = SPECIAL_VIEW_COMPONENTS[language as keyof typeof SPECIAL_VIEW_COMPONENTS]

    if (!SpecialView) return null

    return (
      <Suspense fallback={null}>
        <SpecialView ref={specialViewRef} enableToolbar={codeImageTools} isStreaming={isStreaming}>
          {children}
        </SpecialView>
      </Suspense>
    )
  }, [children, codeImageTools, isStreaming, language])

  const renderHeader = useMemo(() => {
    if (isInSpecialView) {
      return (
        <div className="code-block-header mt-1.5 flex h-4 items-center rounded-t-lg bg-transparent px-2.5 text-xs leading-none font-medium text-muted-foreground" />
      )
    }
    const ext = getExtensionByLanguage(language)
    const iconName = getFileIconName(`file${ext}`)
    return (
      <div className="code-block-header flex h-8 items-center border-b-[0.5px] border-border-subtle bg-background-subtle px-2.5 text-xs leading-none font-medium text-muted-foreground">
        <Icon icon={`material-icon-theme:${iconName}`} style={{ fontSize: '1.1em', marginRight: 6 }} />
        {language.toUpperCase()}
      </div>
    )
  }, [isInSpecialView, language])

  // 根据视图模式和语言选择组件，优先展示特殊视图，fallback是源代码视图
  const renderContent = useMemo(() => {
    const showSpecialView = !!specialView && ['special', 'split'].includes(viewMode)
    const showSourceView = !specialView || viewMode !== 'special'

    return (
      <div
        className={cn(
          'split-view-wrapper flex *:min-w-0 *:flex-1',
          !hasStatusBar && (showSpecialView && !showSourceView ? 'rounded-lg' : 'rounded-b-lg'),
          !hasStatusBar && '[&_.code-viewer]:rounded-[inherit]',
          showSpecialView &&
            showSourceView &&
            "relative before:absolute before:top-0 before:bottom-0 before:left-1/2 before:z-[1] before:w-px before:-translate-x-1/2 before:bg-muted before:content-['']"
        )}>
        {showSpecialView && specialView}
        {showSourceView && sourceView}
      </div>
    )
  }, [hasStatusBar, specialView, sourceView, viewMode])

  return (
    <div
      data-ui="part:code-block"
      className={cn(
        'code-block relative w-full min-w-0 overflow-hidden rounded-lg border-[0.5px] border-border bg-background-subtle',
        '[&_.code-toolbar]:transform-gpu [&_.code-toolbar]:opacity-0 [&_.code-toolbar]:transition-opacity [&_.code-toolbar]:duration-200 [&_.code-toolbar]:ease-in-out [&_.code-toolbar]:will-change-[opacity]',
        '[&_.code-toolbar.show]:opacity-100 [&:hover_.code-toolbar]:opacity-100',
        isInSpecialView
          ? '[&_.code-toolbar]:rounded-none [&_.code-toolbar]:bg-transparent'
          : '[&_.code-toolbar]:rounded-[4px] [&_.code-toolbar]:bg-muted'
      )}>
      {renderHeader}
      {showToolbar ? <CodeToolbar tools={tools} /> : null}
      {renderContent}
      {isExecutable && executionResult && (
        <StatusBar>
          {executionResult.text}
          {executionResult.image && (
            <ImageViewer src={executionResult.image} alt="Matplotlib plot" style={{ cursor: 'pointer' }} />
          )}
        </StatusBar>
      )}
    </div>
  )
})
