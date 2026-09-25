import { SpellCheck, Volume2 } from 'lucide-react'
import type { FC, RefObject } from 'react'
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Button, type CodeEditorHandles, EmptyState, Skeleton, SpaceBetweenRowFlex, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ActionIconButton from '@renderer/components/ActionIconButton'
import DictationControls from '@renderer/components/DictationControls'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import Selector from '@renderer/components/Selector'
import { useCmTheme } from '@renderer/hooks/useCodeStyle'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { toast } from '@renderer/services/toast'
import { readTextAloud, voiceTargetManager } from '@renderer/services/voice'
import type { EditorView } from '@renderer/types/app'

const logger = loggerService.withContext('NotesEditor')
// Hides the toolbar button and the slash-menu entry only. Image *paste* stays enabled: notes have
// persisted pasted images into the user's notes folder since the module shipped, and
// `handleImagePaste` pins those entries with `cleanupPolicy: 'manual'` for exactly this path.
const DISABLED_RICH_EDITOR_COMMANDS = ['image', 'inlineMath'] as const

const CodeEditor = lazy(() => import('@cherrystudio/ui/components/composites/code-editor'))
const RichEditor = lazy(() => import('@renderer/components/RichEditor/RichEditor'))

export function NotesEditorLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 p-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

interface NotesEditorProps {
  activeNodeId?: string
  voiceNoteId?: string
  dictationContainer?: HTMLDivElement | null
  currentContent: string
  contentLoadError?: Error
  tokenCount: number
  editorRef: RefObject<RichEditorRef | null>
  codeEditorRef: RefObject<CodeEditorHandles | null>
  onMarkdownChange: (content: string) => void
  onCreateNote?: () => void
}

const NotesEditor: FC<NotesEditorProps> = memo(
  ({
    activeNodeId,
    voiceNoteId,
    dictationContainer,
    currentContent,
    contentLoadError,
    tokenCount,
    onMarkdownChange,
    editorRef,
    codeEditorRef,
    onCreateNote
  }) => {
    const { t } = useTranslation()
    const { settings } = useNotesSettings()
    const [enableSpellCheck, setEnableSpellCheck] = usePreference('app.spell_check.enabled')
    const currentViewMode = useMemo(() => {
      if (settings.defaultViewMode === 'edit') {
        return settings.defaultEditMode
      } else {
        return settings.defaultViewMode
      }
    }, [settings.defaultEditMode, settings.defaultViewMode])
    const [tmpViewMode, setTmpViewMode] = useState(currentViewMode)
    const activeCmTheme = useCmTheme(tmpViewMode === 'source')
    const currentViewModeRef = useRef(currentViewMode)
    const userViewModeOverrideRef = useRef(false)
    const readButtonRef = useRef<HTMLButtonElement>(null)
    const [richReady, setRichReady] = useState(false)
    const [sourceReady, setSourceReady] = useState(false)
    const onRichRef = useCallback(
      (instance: RichEditorRef | null) => {
        editorRef.current = instance
        setRichReady(Boolean(instance))
      },
      [editorRef]
    )
    const onSourceRef = useCallback(
      (instance: CodeEditorHandles | null) => {
        codeEditorRef.current = instance
        setSourceReady(Boolean(instance))
      },
      [codeEditorRef]
    )
    const editorReady = tmpViewMode === 'source' ? sourceReady : richReady
    const voiceIdentityRef = useRef(voiceNoteId)
    voiceIdentityRef.current = voiceNoteId
    const voiceTargetId = voiceNoteId ? `notes:${voiceNoteId}:${tmpViewMode}` : undefined
    const markVoiceTargetCurrent = () => voiceTargetId && voiceTargetManager.markCurrent(voiceTargetId)

    useEffect(() => {
      if (!activeNodeId || !voiceNoteId || !voiceTargetId || contentLoadError || tmpViewMode === 'read') return
      const currentEditor = () => (tmpViewMode === 'source' ? codeEditorRef.current : editorRef.current)
      return voiceTargetManager.bind({
        targetId: voiceTargetId,
        owner: window,
        sourceEntityId: voiceNoteId,
        captureReplaceRange: () => {
          const selection = currentEditor()?.getSelection?.()
          return selection ? { from: selection.from, to: selection.to } : null
        },
        replaceRange: (range, text) => currentEditor()?.replaceRange?.(range, text) ?? false
      })
    }, [activeNodeId, voiceNoteId, voiceTargetId, contentLoadError, tmpViewMode, editorRef, codeEditorRef])

    const readCurrentNote = () => {
      if (!voiceNoteId) return
      const selection =
        tmpViewMode === 'source' ? codeEditorRef.current?.getSelection?.() : editorRef.current?.getSelection()
      const selectedText = selection?.text ?? ''
      const draft =
        tmpViewMode === 'source'
          ? (codeEditorRef.current?.getContent?.() ?? currentContent)
          : (editorRef.current?.getMarkdown() ?? currentContent)
      const text = selectedText.trim() ? selectedText : draft
      if (!text.trim()) return
      const mode = selectedText.trim() ? 'selection' : 'document'
      void readTextAloud({
        text,
        mode,
        sourceLabel: mode,
        sourceEntityId: voiceNoteId,
        isCurrent: () => voiceIdentityRef.current === voiceNoteId,
        focusOnClose: () => {
          if (tmpViewMode === 'source') codeEditorRef.current?.focus?.()
          else if (tmpViewMode === 'preview') editorRef.current?.focus()
          else readButtonRef.current?.focus()
        }
      })
    }

    useEffect(() => {
      currentViewModeRef.current = currentViewMode
      if (!userViewModeOverrideRef.current) {
        setTmpViewMode(currentViewMode)
      }
    }, [currentViewMode])

    useEffect(() => {
      userViewModeOverrideRef.current = false
      setTmpViewMode(currentViewModeRef.current)
    }, [activeNodeId])

    if (!activeNodeId) {
      return (
        <div data-ui="notes.editor" className="flex h-full w-full flex-1 items-center justify-center">
          <EmptyState
            preset="no-note"
            title={t('notes.empty')}
            actionLabel={t('notes.new_note')}
            onAction={onCreateNote}
          />
        </div>
      )
    }

    if (contentLoadError) {
      return (
        <div data-ui="notes.editor" className="flex h-full w-full flex-1 items-center justify-center">
          <EmptyState
            preset="no-note"
            title={t('notes.load_failed')}
            description={t('notes.load_failed_description')}
          />
        </div>
      )
    }

    const dictationControls = voiceNoteId ? (
      <div onFocusCapture={markVoiceTargetCurrent} onPointerDownCapture={markVoiceTargetCurrent}>
        <DictationControls
          targetId={voiceTargetId ?? ''}
          disabled={tmpViewMode === 'read' || !editorReady}
          focusInput={() => {
            if (tmpViewMode === 'source') codeEditorRef.current?.focus?.()
            else editorRef.current?.focus()
          }}
        />
      </div>
    ) : null

    return (
      <>
        <div
          data-ui="notes.editor"
          data-note-id={activeNodeId}
          onFocusCapture={markVoiceTargetCurrent}
          onPointerDownCapture={markVoiceTargetCurrent}
          className="flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-200 [&_.notes-rich-editor]:flex-1 [&_.notes-rich-editor]:rounded-none [&_.notes-rich-editor]:border-0 [&_.notes-rich-editor]:bg-transparent [&_.notes-rich-editor_.rich-editor-content]:flex-1 [&_.notes-rich-editor_.rich-editor-content]:overflow-auto [&_.notes-rich-editor_.rich-editor-content]:p-4 [&_.notes-rich-editor_.rich-editor-content]:transition-all [&_.notes-rich-editor_.rich-editor-content]:duration-150 [&_.notes-rich-editor_.rich-editor-wrapper]:flex [&_.notes-rich-editor_.rich-editor-wrapper]:h-full [&_.notes-rich-editor_.rich-editor-wrapper]:flex-col [&_.notes-rich-editor_.rich-editor-wrapper]:transition-all [&_.notes-rich-editor_.rich-editor-wrapper]:duration-150">
          <ErrorBoundary>
            <Suspense fallback={<NotesEditorLoading label={t('common.loading')} />}>
              {tmpViewMode === 'source' ? (
                <div className={`h-full ${settings.isFullWidth ? 'w-full' : 'mx-auto w-[60%]'}`}>
                  <CodeEditor
                    ref={onSourceRef}
                    value={currentContent}
                    language="markdown"
                    onChange={onMarkdownChange}
                    className="h-full"
                    expanded={false}
                    height="100%"
                    theme={activeCmTheme}
                    fontSize={settings.fontSize}
                  />
                </div>
              ) : (
                <RichEditor
                  key={`${activeNodeId}-${tmpViewMode === 'preview' ? 'preview' : 'read'}`}
                  ref={onRichRef}
                  initialContent={currentContent}
                  onMarkdownChange={tmpViewMode === 'preview' ? onMarkdownChange : undefined}
                  showToolbar={tmpViewMode === 'preview'}
                  editable={tmpViewMode === 'preview'}
                  autoFocus={currentContent.trim().length === 0}
                  showTableOfContents={settings.showTableOfContents}
                  lineBreaks={settings.lineBreaks}
                  enableContentSearch
                  className="notes-rich-editor rounded-none! [&_.ToolbarWrapper]:rounded-none!"
                  wrapperStyle={{ border: 'none', borderRadius: 0, background: 'transparent' }}
                  isFullWidth
                  fontFamily={settings.fontFamily}
                  fontSize={settings.fontSize}
                  enableSpellCheck={enableSpellCheck}
                  disabledCommands={DISABLED_RICH_EDITOR_COMMANDS}
                />
              )}
            </Suspense>
          </ErrorBoundary>
        </div>
        <div className="flex h-12 shrink-0 items-center border-border border-t px-4 py-2">
          <SpaceBetweenRowFlex className="w-full items-center">
            <div className="select-none text-muted-foreground text-xs leading-none">
              {t('notes.characters')}: {tokenCount}
            </div>
            <div className="flex items-center gap-3 text-muted-foreground text-xs">
              {voiceNoteId && (
                <>
                  {dictationContainer ? createPortal(dictationControls, dictationContainer) : dictationControls}
                  <Button
                    ref={readButtonRef}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('chat.message.read_aloud.label')}
                    disabled={!currentContent.trim()}
                    onClick={readCurrentNote}>
                    <Volume2 className="size-4" />
                  </Button>
                </>
              )}
              {tmpViewMode === 'preview' && (
                <Tooltip placement="top" content={t('notes.spell_check_tooltip')}>
                  <ActionIconButton
                    active={enableSpellCheck}
                    onClick={() => {
                      void setEnableSpellCheck(!enableSpellCheck).catch((error) => {
                        logger.error('Failed to update spell check preference', error as Error)
                        toast.error(t('notes.settings.save_failed'))
                      })
                    }}
                    icon={<SpellCheck size={18} />}
                  />
                </Tooltip>
              )}
              <Selector
                value={tmpViewMode}
                onChange={(value: EditorView) => {
                  userViewModeOverrideRef.current = true
                  setTmpViewMode(value)
                }}
                options={[
                  { label: t('notes.settings.editor.edit_mode.preview_mode'), value: 'preview' },
                  { label: t('notes.settings.editor.edit_mode.source_mode'), value: 'source' },
                  { label: t('notes.settings.editor.view_mode.read_mode'), value: 'read' }
                ]}
              />
            </div>
          </SpaceBetweenRowFlex>
        </div>
      </>
    )
  }
)

NotesEditor.displayName = 'NotesEditor'

export default NotesEditor
