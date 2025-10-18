import type { BasicSetupOptions } from '@uiw/react-codemirror'
import CodeMirror, { Annotation, EditorView } from '@uiw/react-codemirror'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { memo } from 'react'

import { useBlurHandler, useHeightListener, useLanguageExtensions, useSaveKeymap } from './hooks'
import type { CodeEditorProps } from './types'
import { prepareCodeChanges } from './utils'

/**
 * A code editor component based on CodeMirror.
 * This is a wrapper of ReactCodeMirror.
 */
const CodeEditor = ({
  ref,
  value,
  placeholder,
  language,
  languageConfig,
  onSave,
  onChange,
  onBlur,
  onHeightChange,
  height,
  maxHeight,
  minHeight,
  options,
  extensions,
  theme = 'light',
  fontSize = 16,
  style,
  className,
  editable = true,
  readOnly = false,
  expanded = true,
  wrapped = true
}: CodeEditorProps) => {
  const basicSetup = useMemo(() => {
    return {
      dropCursor: true,
      allowMultipleSelections: true,
      indentOnInput: true,
      bracketMatching: true,
      closeBrackets: true,
      rectangularSelection: true,
      crosshairCursor: true,
      highlightActiveLineGutter: false,
      highlightSelectionMatches: true,
      closeBracketsKeymap: options?.keymap,
      searchKeymap: options?.keymap,
      foldKeymap: options?.keymap,
      completionKeymap: options?.keymap,
      lintKeymap: options?.keymap,
      ...(options as BasicSetupOptions)
    }
  }, [options])

  const initialContent = useRef(options?.stream ? (value ?? '').trimEnd() : (value ?? ''))
  const editorViewRef = useRef<EditorView | null>(null)

  const langExtensions = useLanguageExtensions(language, options?.lint, languageConfig)

  const handleSave = useCallback(() => {
    const currentDoc = editorViewRef.current?.state.doc.toString() ?? ''
    onSave?.(currentDoc)
  }, [onSave])

  // Calculate changes during streaming response to update EditorView
  // Cannot handle user editing code during streaming response (and probably doesn't need to)
  useEffect(() => {
    if (!editorViewRef.current) return

    const newContent = options?.stream ? (value ?? '').trimEnd() : (value ?? '')
    const currentDoc = editorViewRef.current.state.doc.toString()

    const changes = prepareCodeChanges(currentDoc, newContent)

    if (changes && changes.length > 0) {
      editorViewRef.current.dispatch({
        changes,
        annotations: [Annotation.define<boolean>().of(true)]
      })
    }
  }, [options?.stream, value])

  const saveKeymapExtension = useSaveKeymap({ onSave, enabled: options?.keymap })
  const blurExtension = useBlurHandler({ onBlur })
  const heightListenerExtension = useHeightListener({ onHeightChange })

  const customExtensions = useMemo(() => {
    return [
      ...(extensions ?? []),
      ...langExtensions,
      ...(wrapped ? [EditorView.lineWrapping] : []),
      saveKeymapExtension,
      blurExtension,
      heightListenerExtension
    ].flat()
  }, [extensions, langExtensions, wrapped, saveKeymapExtension, blurExtension, heightListenerExtension])

  useImperativeHandle(ref, () => ({
    save: handleSave
  }))

  return (
    <CodeMirror
      // Set to a stable value to avoid triggering CodeMirror reset
      value={initialContent.current}
      placeholder={placeholder}
      width="100%"
      height={expanded ? undefined : height}
      maxHeight={expanded ? undefined : maxHeight}
      minHeight={minHeight}
      editable={editable}
      readOnly={readOnly}
      theme={theme}
      extensions={customExtensions}
      onCreateEditor={(view: EditorView) => {
        editorViewRef.current = view
        onHeightChange?.(view.scrollDOM?.scrollHeight ?? 0)
      }}
      onChange={(value, viewUpdate) => {
        if (onChange && viewUpdate.docChanged) onChange(value)
      }}
      basicSetup={basicSetup}
      style={{
        fontSize,
        marginTop: 0,
        borderRadius: 'inherit',
        ...style
      }}
      className={`code-editor ${className ?? ''}`}
    />
  )
}

CodeEditor.displayName = 'CodeEditor'

export default memo(CodeEditor)
