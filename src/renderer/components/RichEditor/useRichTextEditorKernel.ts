import type { EditorOptions } from '@tiptap/core'
import { useEditor, type UseEditorOptions } from '@tiptap/react'
import { useEffect, useMemo } from 'react'

export interface UseRichTextEditorKernelOptions {
  extensions: EditorOptions['extensions']
  content?: EditorOptions['content']
  editable?: boolean
  placeholder?: string
  enableSpellCheck?: boolean
  shouldRerenderOnTransaction?: boolean
  editorProps?: EditorOptions['editorProps']
  handlePaste?: EditorOptions['editorProps']['handlePaste']
  onUpdate?: EditorOptions['onUpdate']
  onBlur?: EditorOptions['onBlur']
  onCreate?: EditorOptions['onCreate']
}

export function useRichTextEditorKernel({
  extensions,
  content = '',
  editable = true,
  enableSpellCheck = false,
  shouldRerenderOnTransaction = false,
  editorProps,
  handlePaste,
  onUpdate,
  onBlur,
  onCreate
}: UseRichTextEditorKernelOptions) {
  const mergedEditorProps = useMemo<EditorOptions['editorProps']>(() => {
    const readOnlyStyle = editable
      ? ''
      : 'user-select: text; -webkit-user-select: text; -moz-user-select: text; -ms-user-select: text;'
    const mergeAttributes = (attributes: Record<string, string> = {}) => {
      const baseStyle = typeof attributes.style === 'string' ? attributes.style : ''

      return {
        ...attributes,
        style: [baseStyle, readOnlyStyle].filter(Boolean).join('; '),
        spellcheck: enableSpellCheck ? 'true' : 'false'
      }
    }
    const baseAttributes = editorProps?.attributes

    return {
      ...editorProps,
      ...(handlePaste && { handlePaste }),
      attributes:
        typeof baseAttributes === 'function'
          ? (state) => mergeAttributes(baseAttributes(state))
          : mergeAttributes(baseAttributes)
    }
  }, [editable, editorProps, enableSpellCheck, handlePaste])

  const options = useMemo<UseEditorOptions>(
    () => ({
      shouldRerenderOnTransaction,
      extensions,
      content,
      editable,
      editorProps: mergedEditorProps,
      onUpdate,
      onBlur,
      onCreate
    }),
    [content, editable, extensions, mergedEditorProps, onBlur, onCreate, onUpdate, shouldRerenderOnTransaction]
  )

  const editor = useEditor(options)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(editable)
  }, [editor, editable])

  return editor
}
