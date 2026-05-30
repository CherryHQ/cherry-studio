import { EmptyState, SpaceBetweenRowFlex, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import ActionIconButton from '@renderer/components/Buttons/ActionIconButton'
import CodeEditor, { type CodeEditorHandles } from '@renderer/components/CodeEditor'
import RichEditor from '@renderer/components/RichEditor'
import type { RichEditorRef } from '@renderer/components/RichEditor/types'
import Selector from '@renderer/components/Selector'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import type { EditorView } from '@renderer/types'
import { SpellCheck } from 'lucide-react'
import type { FC, RefObject } from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('NotesEditor')

interface NotesEditorProps {
  activeNodeId?: string
  currentContent: string
  contentLoadError?: Error
  tokenCount: number
  editorRef: RefObject<RichEditorRef | null>
  codeEditorRef: RefObject<CodeEditorHandles | null>
  onMarkdownChange: (content: string) => void
}

const NotesEditor: FC<NotesEditorProps> = memo(
  ({ activeNodeId, currentContent, contentLoadError, tokenCount, onMarkdownChange, editorRef, codeEditorRef }) => {
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
    const currentViewModeRef = useRef(currentViewMode)
    const userViewModeOverrideRef = useRef(false)

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

    const handleCommandsReady = useCallback((commandAPI: Pick<RichEditorRef, 'unregisterCommand'>) => {
      const disabledCommands = ['image', 'inlineMath']
      disabledCommands.forEach((commandId) => {
        commandAPI.unregisterCommand(commandId)
      })
    }, [])

    if (!activeNodeId) {
      return (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <EmptyState preset="no-note" title={t('notes.empty')} compact />
        </div>
      )
    }

    if (contentLoadError) {
      return (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <EmptyState
            preset="no-note"
            title={t('notes.load_failed')}
            description={t('notes.load_failed_description')}
            compact
          />
        </div>
      )
    }

    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-200 [&_.notes-rich-editor]:flex-1 [&_.notes-rich-editor]:rounded-none [&_.notes-rich-editor]:border-0 [&_.notes-rich-editor]:bg-transparent [&_.notes-rich-editor_.rich-editor-content]:flex-1 [&_.notes-rich-editor_.rich-editor-content]:overflow-auto [&_.notes-rich-editor_.rich-editor-content]:p-4 [&_.notes-rich-editor_.rich-editor-content]:transition-all [&_.notes-rich-editor_.rich-editor-content]:duration-150 [&_.notes-rich-editor_.rich-editor-wrapper]:flex [&_.notes-rich-editor_.rich-editor-wrapper]:h-full [&_.notes-rich-editor_.rich-editor-wrapper]:flex-col [&_.notes-rich-editor_.rich-editor-wrapper]:transition-all [&_.notes-rich-editor_.rich-editor-wrapper]:duration-150">
          {tmpViewMode === 'source' ? (
            <div className={`h-full ${settings.isFullWidth ? 'w-full' : 'mx-auto w-[60%]'}`}>
              <CodeEditor
                ref={codeEditorRef}
                value={currentContent}
                language="markdown"
                onChange={onMarkdownChange}
                className="h-full"
                expanded={false}
                fontSize={settings.fontSize}
                style={{
                  height: '100%'
                }}
              />
            </div>
          ) : (
            <RichEditor
              key={`${activeNodeId}-${tmpViewMode === 'preview' ? 'preview' : 'read'}`}
              ref={editorRef}
              initialContent={currentContent}
              onMarkdownChange={tmpViewMode === 'preview' ? onMarkdownChange : undefined}
              onCommandsReady={handleCommandsReady}
              showToolbar={tmpViewMode === 'preview'}
              editable={tmpViewMode === 'preview'}
              showTableOfContents={settings.showTableOfContents}
              enableContentSearch
              className="notes-rich-editor rounded-none! [&_.ToolbarWrapper]:rounded-none!"
              wrapperStyle={{ border: 'none', borderRadius: 0, background: 'transparent' }}
              isFullWidth
              fontFamily={settings.fontFamily}
              fontSize={settings.fontSize}
              enableSpellCheck={enableSpellCheck}
            />
          )}
        </div>
        <div className="flex h-12 shrink-0 items-center border-border border-t px-4 py-2">
          <SpaceBetweenRowFlex className="w-full items-center">
            <div className="select-none text-muted-foreground text-xs leading-none">
              {t('notes.characters')}: {tokenCount}
            </div>
            <div className="flex items-center gap-3 text-muted-foreground text-xs">
              {tmpViewMode === 'preview' && (
                <Tooltip placement="top" content={t('notes.spell_check_tooltip')}>
                  <ActionIconButton
                    active={enableSpellCheck}
                    onClick={() => {
                      const newValue = !enableSpellCheck
                      void setEnableSpellCheck(newValue).catch((error) => {
                        logger.error('Failed to update spell check preference', error as Error)
                        window.toast.error(t('notes.settings.save_failed'))
                      })
                      void window.api.setEnableSpellCheck(newValue).catch((error) => {
                        logger.error('Failed to update spell check runtime state', error as Error)
                        window.toast.error(t('notes.settings.save_failed'))
                      })
                    }}
                    icon={<SpellCheck size={18} />}
                  />
                </Tooltip>
              )}
              <Selector
                value={tmpViewMode as EditorView}
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
