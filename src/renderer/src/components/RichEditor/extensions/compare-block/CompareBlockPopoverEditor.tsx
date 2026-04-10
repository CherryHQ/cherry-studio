import type { UseRichEditorOptions } from '@renderer/components/RichEditor/useRichEditor'
import { useRichEditor } from '@renderer/components/RichEditor/useRichEditor'
import { EditorContent } from '@tiptap/react'
import React from 'react'
import styled from 'styled-components'

interface CompareBlockPopoverEditorProps {
  initialContent: string
  onMarkdownChange: (markdown: string) => void
}

export const CompareBlockPopoverEditor: React.FC<CompareBlockPopoverEditorProps> = ({
  initialContent,
  onMarkdownChange
}) => {
  const options: UseRichEditorOptions = {
    initialContent,
    onChange: onMarkdownChange,
    placeholder: '粘贴 AI 内容到这里进行对照…',
    editable: true,
    enableSpellCheck: false,
    // 避免递归在对照区里再插入对照区
    enableCompareBlock: false
  }

  const { editor } = useRichEditor(options)

  return (
    <EditorShell>
      <EditorContent editor={editor} />
    </EditorShell>
  )
}

export default CompareBlockPopoverEditor

const EditorShell = styled.div`
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-background) 90%, white);

  .ProseMirror {
    padding: 10px;
    min-height: 160px;
    max-height: 320px;
    overflow: auto;
  }
`
