import { TextAreaRef } from 'antd/es/input/TextArea'
import { RefObject } from 'react'

export const insertTextAtCursor = ({
  text,
  pasteText,
  textareaRef,
  setText
}: {
  text: string
  pasteText: string
  textareaRef: RefObject<TextAreaRef>
  setText: (text: string) => void
}) => {
  const textarea = textareaRef.current?.resizableTextArea?.textArea

  if (!textarea) {
    return
  }

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const newValue = text.substring(0, start) + pasteText + text.substring(end)

  setText(newValue)

  setTimeout(() => {
    textarea.setSelectionRange(start + pasteText.length, start + pasteText.length)
    textarea.focus()
  }, 0)
}
