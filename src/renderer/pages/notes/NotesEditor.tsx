import { SpellCheck, Volume2 } from 'lucide-react'
import type { FC, RefObject } from 'react'
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
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
    const activeViewModeRef = useRef(tmpViewMode)
    activeViewModeRef.current = tmpViewMode
    const userViewModeOverrideRef = useRef(false)
    const readButtonRef = useRef<HTMLButtonElement>(null)
    const voiceIdentityRef = useRef(voiceNoteId)
    voiceIdentityRef.current = voiceNoteId
    const [richEditorReady, setRichEditorReady] = useState(false)
    const [sourceEditorReady, setSourceEditorReady] = useState(false)
    const [, refreshVoiceTarget] = useReducer((version: number) => version + 1, 0)
    const voiceTargetId = voiceNoteId ? `notes:${voiceNoteId}:${tmpViewMode}` : ''
    const voiceEditorReady = tmpViewMode === 'source' ? sourceEditorReady : richEditorReady
    const setRichEditorRef = useCallback(
      (instance: RichEditorRef | null) => {
        editorRef.current = instance
        setRichEditorReady(instance?.getSelection() != null)
      },
      [editorRef]
    )
    const setSourceEditorRef = useCallback(
      (instance: CodeEditorHandles | null) => {
        codeEditorRef.current = instance
        setSourceEditorReady(instance !== null)
      },
      [codeEditorRef]
    )
    const markVoiceTargetCurrent = () => {
      if (voiceTargetManager.captureCurrent()?.targetId === voiceTargetId) return
      if (voiceTargetManager.markCurrent(voiceTargetId)) refreshVoiceTarget()
    }
    const focusCurrentEditor = () => {
      if (voiceIdentityRef.current !== voiceNoteId || !readButtonRef.current) return
      if (activeViewModeRef.current === 'source' && codeEditorRef.current?.focus) codeEditorRef.current.focus()
      else if (activeViewModeRef.current === 'preview' && editorRef.current) editorRef.current.focus()
      else readButtonRef.current.focus()
    }

    useEffect(() => {
      if (!activeNodeId || !voiceNoteId || contentLoadError || tmpViewMode === 'read' || !voiceEditorReady) return
      const isCurrent = () => voiceIdentityRef.current === voiceNoteId && activeViewModeRef.current === tmpViewMode
      return voiceTargetManager.bind({
        targetId: voiceTargetId,
        sourceEntityId: voiceNoteId,
        owner: window,
        captureReplaceRange: () => {
          if (!isCurrent()) return null
          const selection =
            tmpViewMode === 'source' ? codeEditorRef.current?.getSelection?.() : editorRef.current?.getSelection()
          return selection ? { from: selection.from, to: selection.to } : null
        },
        replaceRange: (range, text) => {
          if (!isCurrent()) return false
          return tmpViewMode === 'source'
            ? (codeEditorRef.current?.replaceRange?.(range, text) ?? false)
            : (editorRef.current?.replaceRange(range, text) ?? false)
        }
      })
    }, [
      activeNodeId,
      voiceNoteId,
      contentLoadError,
      tmpViewMode,
      voiceEditorReady,
      voiceTargetId,
      codeEditorRef,
      editorRef
    ])

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
      const isCurrent = () => voiceIdentityRef.current === voiceNoteId && readButtonRef.current !== null
      void readTextAloud({
        text,
        mode,
        sourceLabel: mode,
        sourceEntityId: voiceNoteId,
        isCurrent,
        focusOnClose: focusCurrentEditor
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
                    ref={setSourceEditorRef}
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
                  ref={setRichEditorRef}
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
        <div
          className="flex min-h-12 shrink-0 items-center border-border border-t px-4 py-2"
          onFocusCapture={markVoiceTargetCurrent}
          onPointerDownCapture={markVoiceTargetCurrent}>
          <SpaceBetweenRowFlex className="w-full flex-wrap items-center gap-2">
            <div className="select-none text-muted-foreground text-xs leading-none">
              {t('notes.characters')}: {tokenCount}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 text-muted-foreground text-xs">
              {voiceNoteId && (
                <DictationControls
                  targetId={voiceTargetId}
                  disabled={tmpViewMode === 'read' || !voiceEditorReady}
                  focusInput={focusCurrentEditor}
                />
              )}
              {voiceNoteId && (
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
