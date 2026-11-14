import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react'
import dayjs from 'dayjs'
import { Scan } from 'lucide-react'
import type { FC } from 'react'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@cherrystudio/ui'
import { CODE_LANGUAGES } from '@cherrystudio/ui/code-highlight'
import { type ActionTool, TOOL_SPECS, useToolManager } from '@renderer/components/ActionTools'
import { SPECIAL_VIEW_COMPONENTS, SPECIAL_VIEWS } from '@renderer/components/CodeBlockView/constants'
import type { ViewMode } from '@renderer/components/CodeBlockView/types'
import { CodeToolButton, useCopyTool, useDownloadTool, useViewSourceTool } from '@renderer/components/CodeToolbar'
import type { BasicPreviewHandles } from '@renderer/components/Preview/types'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { getExtensionByLanguage } from '@renderer/utils/codeLanguage'

const languageOptions = [
  ...new Set([...Object.keys(CODE_LANGUAGES), ...Object.values(CODE_LANGUAGES).flat(), ...SPECIAL_VIEWS])
].sort()

const options = languageOptions.map((value) => ({ value, label: value }))

// View actions first, then output: copying the image sits beside copying the source.
const TOOL_ORDER = ['dialog', 'edit', 'view-source', 'copy-image', 'copy', 'download']

const CodeBlockNodeView: FC<ReactNodeViewProps> = (props) => {
  const { node, updateAttributes, editor } = props
  const { t } = useTranslation()
  const { codeBlockStyle } = useCodeStyle()

  // Detect language from node attrs or fallback
  const language = (node.attrs.language as string) || 'text'
  const isSpecialView = SPECIAL_VIEWS.includes(language)
  const specialView = isSpecialView ? SPECIAL_VIEW_COMPONENTS[language as keyof typeof SPECIAL_VIEW_COMPONENTS] : null
  const isEditable = editor.isEditable
  // A new block has no source to preview yet, and typing into the hidden source would land outside it.
  const [showPreview, setShowPreview] = useState(() => node.textContent.trim().length > 0)
  const isPreviewing = isSpecialView && showPreview
  const showImageTools = isPreviewing && Boolean(specialView?.supportsImageActions)
  const previewRef = useRef<BasicPreviewHandles | null>(null)
  const [tools, setTools] = useState<ActionTool[]>([])
  const { registerTool, removeTool } = useToolManager(setTools)

  // Handle language change
  const handleLanguageChange = useCallback(
    (value: string | string[]) => {
      if (typeof value === 'string') {
        editor.view.focus()
        updateAttributes({ language: value })
      }
    },
    [editor, updateAttributes]
  )

  const handleCopySource = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(node.textContent)
      return true
    } catch {
      // Clipboard may fail (e.g. non-secure context)
      return false
    }
  }, [node])

  const handleDownloadSource = useCallback(() => {
    void window.api.file.save(`${dayjs().format('YYYYMMDDHHmm')}${getExtensionByLanguage(language)}`, node.textContent)
  }, [language, node])

  const handleViewModeChange = useCallback((mode: ViewMode) => setShowPreview(mode === 'special'), [])

  useCopyTool({ showPreviewTools: showImageTools, previewRef, onCopySource: handleCopySource, setTools })
  useDownloadTool({ showPreviewTools: showImageTools, previewRef, onDownloadSource: handleDownloadSource, setTools })
  useViewSourceTool({
    canEdit: isEditable && isSpecialView,
    hasSpecialView: isSpecialView,
    isStreaming: false,
    viewMode: showPreview ? 'special' : 'edit',
    onViewModeChange: handleViewModeChange,
    setTools
  })

  // Zoom and pan live in the full-size viewer; an inline diagram scrolls with the note.
  useEffect(() => {
    if (!showImageTools) return
    registerTool({
      ...TOOL_SPECS.dialog,
      icon: <Scan className="tool-icon" />,
      tooltip: t('preview.dialog'),
      onClick: () => void previewRef.current?.dialog()
    })
    return () => removeTool(TOOL_SPECS.dialog.id)
  }, [registerTool, removeTool, showImageTools, t])

  const toolbar = (
    <div className="flex items-center gap-0.5">
      {tools
        .toSorted((a, b) => TOOL_ORDER.indexOf(a.id) - TOOL_ORDER.indexOf(b.id))
        .map((tool) => (
          <CodeToolButton key={tool.id} tool={tool} />
        ))}
    </div>
  )

  if (specialView && isPreviewing) {
    const SpecialComponent = specialView.component

    return (
      <NodeViewWrapper className="code-block-wrapper code-syntax-root" style={codeBlockStyle}>
        <div className="code-block-header rounded-lg border-[0.5px] border-border bg-popover p-0.5 shadow-xs">
          {toolbar}
        </div>
        <div className="special-preview-wrapper">
          <Suspense fallback={null}>
            <SpecialComponent ref={specialView.supportsImageActions ? previewRef : undefined}>
              {node.textContent}
            </SpecialComponent>
          </Suspense>
        </div>
        <pre
          className={`language-${language}`}
          style={{ display: 'none', backgroundColor: 'var(--code-background)', color: 'var(--code-foreground)' }}>
          <NodeViewContent<'code'> as="code" />
        </pre>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="code-block-wrapper code-syntax-root" style={codeBlockStyle}>
      <div className="code-block-header rounded-lg border-[0.5px] border-border bg-popover p-0.5 shadow-xs">
        <Combobox
          value={language}
          options={options}
          onChange={handleLanguageChange}
          size="sm"
          className="code-block-language-select min-w-[90px]"
          aria-label={t('common.language')}
          searchPlaceholder={t('common.search')}
          emptyText={t('common.no_results')}
          filterOption={(option, search) => option.value.toLowerCase().includes(search.trim().toLowerCase())}
          renderValue={() => language}
        />
        <div aria-hidden className="h-4 w-[0.5px] bg-border" />
        {toolbar}
      </div>
      <pre
        className={`language-${language}`}
        style={{ backgroundColor: 'var(--code-background)', color: 'var(--code-foreground)', tabSize: 2 }}>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}

// The header's tool buttons are divs, which ProseMirror would otherwise treat as a click into the document.
export const CodeBlockNodeReactRenderer = ReactNodeViewRenderer(CodeBlockNodeView, {
  stopEvent: ({ event }) => event.target instanceof Element && event.target.closest('.code-block-header') !== null
})

export default CodeBlockNodeView
