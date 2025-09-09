import CodeEditor from '@renderer/components/CodeEditor'
import { HSpaceBetweenStack } from '@renderer/components/Layout'
import RichEditor from '@renderer/components/RichEditor'
import { RichEditorRef } from '@renderer/components/RichEditor/types'
import Selector from '@renderer/components/Selector'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { EditorView } from '@renderer/types'
import { Empty, Spin } from 'antd'
import { FC, memo, RefObject, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface NotesEditorProps {
  activeNodeId?: string
  currentContent: string
  tokenCount: number
  isLoading: boolean
  editorRef: RefObject<RichEditorRef | null>
  onMarkdownChange: (content: string) => void
}

const NotesEditor: FC<NotesEditorProps> = memo(
  ({ activeNodeId, currentContent, tokenCount, isLoading, onMarkdownChange, editorRef }) => {
    const { t } = useTranslation()
    const { settings } = useNotesSettings()
    const currentViewMode = useMemo(() => {
      if (settings.defaultViewMode === 'edit') {
        return settings.defaultEditMode
      } else {
        return settings.defaultViewMode
      }
    }, [settings.defaultEditMode, settings.defaultViewMode])
    const [tmpViewMode, setTmpViewMode] = useState(currentViewMode)

    const handleCommandsReady = useCallback((commandAPI: Pick<RichEditorRef, 'unregisterCommand'>) => {
      const disabledCommands = ['image', 'inlineMath']
      disabledCommands.forEach((commandId) => {
        commandAPI.unregisterCommand(commandId)
      })
    }, [])

    if (!activeNodeId) {
      return (
        <EmptyContainer>
          <Empty description={t('notes.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </EmptyContainer>
      )
    }

    if (isLoading) {
      return (
        <LoadingContainer>
          <Spin tip={t('common.loading')} />
        </LoadingContainer>
      )
    }

    return (
      <>
        <RichEditorContainer>
          {tmpViewMode === 'source' ? (
            <SourceEditorWrapper isFullWidth={settings.isFullWidth} fontSize={settings.fontSize}>
              <CodeEditor
                value={currentContent}
                language="markdown"
                onChange={onMarkdownChange}
                height="100%"
                expanded={false}
                style={{
                  height: '100%',
                  fontSize: `${settings.fontSize}px`
                }}
              />
            </SourceEditorWrapper>
          ) : (
            <RichEditor
              key={`${activeNodeId}-${tmpViewMode === 'preview' ? 'preview' : 'read'}`}
              ref={editorRef}
              initialContent={currentContent}
              onMarkdownChange={onMarkdownChange}
              onCommandsReady={handleCommandsReady}
              showToolbar={tmpViewMode === 'preview'}
              editable={tmpViewMode === 'preview'}
              showTableOfContents={settings.showTableOfContents}
              enableContentSearch
              className="notes-rich-editor"
              isFullWidth={settings.isFullWidth}
              fontFamily={settings.fontFamily}
              fontSize={settings.fontSize}
            />
          )}
        </RichEditorContainer>
        <BottomPanel>
          <HSpaceBetweenStack width="100%" justifyContent="space-between" alignItems="center">
            <TokenCount>
              {t('notes.characters')}: {tokenCount}
            </TokenCount>
            <div
              style={{
                fontSize: '12px',
                color: 'var(--color-text-3)',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}>
              <Selector
                value={tmpViewMode as EditorView}
                onChange={(value: EditorView) => setTmpViewMode(value)}
                options={[
                  { label: t('notes.settings.editor.edit_mode.preview_mode'), value: 'preview' },
                  { label: t('notes.settings.editor.edit_mode.source_mode'), value: 'source' },
                  { label: t('notes.settings.editor.view_mode.read_mode'), value: 'read' }
                ]}
              />
            </div>
          </HSpaceBetweenStack>
        </BottomPanel>
      </>
    )
  }
)

NotesEditor.displayName = 'NotesEditor'

const LoadingContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
`

const EmptyContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  flex: 1;
`

const RichEditorContainer = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  transition: opacity 0.2s ease-in-out;

  .notes-rich-editor {
    border: none;
    border-radius: 0;
    flex: 1;
    background: transparent;

    .rich-editor-wrapper {
      height: 100%;
      display: flex;
      flex-direction: column;
      transition: all 0.15s ease-in-out;
    }

    .rich-editor-content {
      flex: 1;
      overflow: auto;
      padding: 16px;
      transition: all 0.15s ease-in-out;
    }

    /* 预览模式下的样式优化 */
    &[data-preview='true'] {
      .ProseMirror {
        cursor: default !important;
      }
    }
  }
`

const SourceEditorWrapper = styled.div<{ isFullWidth: boolean; fontSize: number }>`
  height: 100%;
  width: ${({ isFullWidth }) => (isFullWidth ? '100%' : '60%')};
  margin: ${({ isFullWidth }) => (isFullWidth ? '0' : '0 auto')};

  /* 应用字体大小到CodeEditor */
  .monaco-editor {
    font-size: ${({ fontSize }) => fontSize}px !important;
  }

  /* 确保CodeEditor内部元素也应用字体大小 */
  .monaco-editor .monaco-editor-background,
  .monaco-editor .inputarea.ime-input,
  .monaco-editor .monaco-editor-container,
  .monaco-editor .overflow-guard,
  .monaco-editor .monaco-scrollable-element,
  .monaco-editor .lines-content.monaco-editor-background,
  .monaco-editor .view-line {
    font-size: ${({ fontSize }) => fontSize}px !important;
  }
`

const BottomPanel = styled.div`
  padding: 8px 16px;
  border-top: 0.5px solid var(--color-border);
  background: var(--color-background-soft);
  flex-shrink: 0;
  height: 48px;
  display: flex;
  align-items: center;
`

const TokenCount = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  user-select: none;
  line-height: 1;
`

export default NotesEditor
