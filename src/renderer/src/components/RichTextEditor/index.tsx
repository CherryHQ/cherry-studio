import 'prosekit/basic/style.css'
import 'prosekit/basic/typography.css'

import { createEditor, type NodeJSON } from 'prosekit/core'
import { ProseKit, useDocChange } from 'prosekit/react'
import { useCallback, useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import styled from 'styled-components'
import TurndownService from 'turndown'

import BlockHandle from './BlockHandle'
import { defineExtension } from './extension'
import InlineMenu from './InlineMenu'
import SlashMenu from './SlashMenu'
import Toolbar from './Toolbar'

interface RichTextEditorProps {
  value: string | NodeJSON
  onChange: (value: string) => void
  height?: string
  placeholder?: string
  showPreview?: boolean
  onSave?: (html: string) => void
}

// 创建TurndownService实例
const turndownService = new TurndownService()

// HTML转Markdown的工具函数
function markdownFromHTML(html: string): string {
  try {
    return turndownService.turndown(html)
  } catch (error) {
    console.error('Error converting HTML to Markdown:', error)
    return html // fallback to original HTML
  }
}

export default function RichTextEditor({
  value,
  onChange,
  height = '400px',
  placeholder = 'Press / for commands...',
  showPreview = false,
  onSave
}: RichTextEditorProps) {
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // 只创建一次编辑器
  const editor = useMemo(() => {
    const extension = defineExtension({ placeholder })
    return createEditor({ extension, defaultContent: value })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholder])

  const handleDocChange = useCallback(() => {
    setHasUnsavedChanges(true)
    const html = editor.getDocHTML()
    onChange(html)
  }, [editor, onChange])

  // 保存功能
  const handleSave = useCallback(() => {
    const html = editor.getDocHTML()
    setHasUnsavedChanges(false)
    onSave?.(html) // 直接传递HTML
  }, [editor, onSave])

  // 切换预览模式
  const togglePreview = useCallback(() => {
    setIsPreviewMode(!isPreviewMode)
  }, [isPreviewMode])

  // ReactMarkdown组件配置
  // TODO: 复用
  const markdownComponents = useMemo(() => {
    return {
      img: (props: any) => <img {...props} style={{ maxWidth: '100%', height: 'auto' }} />,
      pre: (props: any) => (
        <pre
          style={{ overflow: 'auto', background: 'var(--color-background-soft)', padding: '12px', borderRadius: '6px' }}
          {...props}
        />
      ),
      code: (props: any) => (
        <code
          style={{ background: 'var(--color-background-soft)', padding: '2px 4px', borderRadius: '3px' }}
          {...props}
        />
      )
    } as Partial<Components>
  }, [])

  // 用于预览的markdown内容
  const getPreviewContent = () => {
    const html = editor.getDocHTML()
    return markdownFromHTML(html)
  }

  return (
    <EditorContainer height={height}>
      {(showPreview || onSave) && (
        <EditorHeader>
          <HeaderButtons>
            <HeaderButton onClick={togglePreview} $active={!isPreviewMode} disabled={false}>
              编辑
            </HeaderButton>
            <HeaderButton onClick={togglePreview} $active={isPreviewMode} disabled={false}>
              预览
            </HeaderButton>
          </HeaderButtons>
          {onSave && !isPreviewMode && (
            <SaveButton onClick={handleSave} disabled={!hasUnsavedChanges} $hasChanges={hasUnsavedChanges}>
              {hasUnsavedChanges ? '保存' : '已保存'}
            </SaveButton>
          )}
        </EditorHeader>
      )}

      {isPreviewMode ? (
        <PreviewContainer>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>
            {getPreviewContent()}
          </ReactMarkdown>
        </PreviewContainer>
      ) : (
        <ProseKit editor={editor}>
          <EditorWrapper>
            <Toolbar />
            <EditorContent>
              <ProseMirrorContainer ref={editor.mount} className="ProseMirror">
                <DocumentChangeListener onDocChange={handleDocChange} />
              </ProseMirrorContainer>
              <InlineMenu />
              <SlashMenu />
              <BlockHandle />
            </EditorContent>
          </EditorWrapper>
        </ProseKit>
      )}
    </EditorContainer>
  )
}

// 简化的文档变化监听器
function DocumentChangeListener({ onDocChange }: { onDocChange: () => void }) {
  useDocChange(onDocChange)
  return null
}

const EditorContainer = styled.div<{ height: string }>`
  margin-top: 16px;
  height: ${({ height }) => height};
  display: flex;
  flex-direction: column;
`

const EditorHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 8px;
`

const HeaderButtons = styled.div`
  display: flex;
  gap: 4px;
`

const HeaderButton = styled.button<{ $active: boolean }>`
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  background: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-background)')};
  color: ${({ $active }) => ($active ? 'white' : 'var(--color-text)')};
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;

  &:hover {
    background: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-background-soft)')};
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`

const SaveButton = styled.button<{ $hasChanges: boolean }>`
  padding: 6px 12px;
  border: 1px solid ${({ $hasChanges }) => ($hasChanges ? 'var(--color-primary)' : 'var(--color-border)')};
  background: ${({ $hasChanges }) => ($hasChanges ? 'var(--color-primary)' : 'var(--color-background)')};
  color: ${({ $hasChanges }) => ($hasChanges ? 'white' : 'var(--color-text-secondary)')};
  border-radius: 4px;
  cursor: ${({ $hasChanges }) => ($hasChanges ? 'pointer' : 'default')};
  font-size: 12px;

  &:hover {
    background: ${({ $hasChanges }) => ($hasChanges ? 'var(--color-primary-hover)' : 'var(--color-background)')};
  }

  &:disabled {
    cursor: not-allowed;
  }
`

const PreviewContainer = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 2rem max(4rem, calc(50% - 20rem));
  background-color: var(--color-background);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;

  .markdown {
    line-height: 1.6;

    h1,
    h2,
    h3,
    h4,
    h5,
    h6 {
      margin: 1.5em 0 0.5em 0;
      font-weight: 600;
    }

    p {
      margin: 1em 0;
    }

    ul,
    ol {
      margin: 1em 0;
      padding-left: 2em;
    }

    blockquote {
      margin: 1em 0;
      padding-left: 1em;
      border-left: 4px solid var(--color-border);
      color: var(--color-text-secondary);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;

      th,
      td {
        border: 1px solid var(--color-border);
        padding: 8px 12px;
        text-align: left;
      }

      th {
        background: var(--color-background-soft);
        font-weight: 600;
      }
    }
  }
`

const EditorWrapper = styled.div`
  box-sizing: border-box;
  flex: 1;
  width: 100%;
  min-height: 9rem;
  overflow-y: hidden;
  overflow-x: hidden;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  box-shadow:
    0 1px 3px 0 rgb(0 0 0 / 0.1),
    0 1px 2px -1px rgb(0 0 0 / 0.1);
  display: flex;
  flex-direction: column;
  background-color: var(--color-background);
  color: var(--color-text);
`

const EditorContent = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
  box-sizing: border-box;
  overflow-y: scroll;
`

const ProseMirrorContainer = styled.div`
  box-sizing: border-box;
  min-height: 100%;
  padding-left: max(4rem, calc(50% - 20rem));
  padding-right: max(4rem, calc(50% - 20rem));
  padding-top: 2rem;
  padding-bottom: 2rem;
  outline: none;

  & span[data-mention='user'] {
    color: rgb(59 130 246);
  }

  & span[data-mention='tag'] {
    color: rgb(139 92 246);
  }
`
