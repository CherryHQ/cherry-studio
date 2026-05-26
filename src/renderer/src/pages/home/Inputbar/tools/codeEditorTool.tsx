import CodeEditorPopup from '@renderer/components/Popups/CodeEditorPopup'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type { FC } from 'react'
import { useCallback } from 'react'

import CodeEditorButton from './components/CodeEditorButton'

interface CodeEditorToolButtonProps {
  onTextChange: (updater: (prev: string) => string) => void
}

const CodeEditorToolButton: FC<CodeEditorToolButtonProps> = ({ onTextChange }) => {
  const handleOpen = useCallback(async () => {
    const textarea = document.querySelector('.inputbar textarea') as HTMLTextAreaElement | null
    const currentText = textarea?.value ?? ''
    const content = await CodeEditorPopup.show({ content: currentText })
    if (content === null) return

    onTextChange(() => content)
  }, [onTextChange])

  return <CodeEditorButton onClick={handleOpen} />
}

const codeEditorTool = defineTool({
  key: 'code_editor',
  label: (t) => t('chat.input.code_editor.title'),
  visibleInScopes: [TopicType.Chat, TopicType.Session, 'mini-window'],
  dependencies: {
    actions: ['onTextChange'] as const
  },
  render: ({ actions }) => <CodeEditorToolButton onTextChange={actions.onTextChange} />
})

registerTool(codeEditorTool)

export default codeEditorTool
