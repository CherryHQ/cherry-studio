import type { BasicSetupOptions } from '@uiw/react-codemirror'
import CodeMirror, { Annotation, EditorView } from '@uiw/react-codemirror'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { memo } from 'react'

import { useBlurHandler, useHeightListener, useLanguageExtensions, useSaveKeymap, useScrollToLine } from './hooks'
import type { CodeEditorProps } from './types'
import { prepareCodeChanges } from './utils'

const codeEditorGutterTheme = EditorView.theme({
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: 'var(--color-muted-foreground)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent'
  },
  '.cm-activeLine': {
    borderRadius: 'var(--radius-md)',
    padding: '0 4px',
    margin: '0 -4px'
  }
})

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
  wrapped = true,
  autoScrollToBottom = false
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
  const shouldStickToBottomRef = useRef(true)
  const autoScrollToBottomRef = useRef(autoScrollToBottom)
  const expandedRef = useRef(expanded)
  const scrollCleanupRef = useRef<(() => void) | null>(null)

  const langExtensions = useLanguageExtensions(language, options?.lint, languageConfig)

  const handleSave = useCallback(() => {
    const currentDoc = editorViewRef.current?.state.doc.toString() ?? ''
    onSave?.(currentDoc)
  }, [onSave])

  const insertText = useCallback((text: string) => {
    const editorView = editorViewRef.current
    if (!editorView) return false

    editorView.dispatch(editorView.state.replaceSelection(text))
    editorView.focus()
    return true
  }, [])

  const focus = useCallback(() => {
    editorViewRef.current?.focus()
  }, [])

  useEffect(() => {
    autoScrollToBottomRef.current = autoScrollToBottom
    expandedRef.current = expanded
    if (!autoScrollToBottom || expanded) {
      shouldStickToBottomRef.current = true
    }
  }, [autoScrollToBottom, expanded])

  const updateShouldStickToBottom = useCallback((scrollElement: HTMLElement) => {
    const distanceToBottom = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
    shouldStickToBottomRef.current = distanceToBottom <= 8
  }, [])

  const scrollToDocumentBottom = useCallback((view: EditorView) => {
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.doc.length, {
        y: 'end',
        x: 'nearest'
      })
    })
  }, [])

  // Calculate changes during streaming response to update EditorView
  // Cannot handle user editing code during streaming response (and probably doesn't need to)
  useEffect(() => {
    if (!editorViewRef.current) return

    const newContent = options?.stream ? (value ?? '').trimEnd() : (value ?? '')
    const currentDoc = editorViewRef.current.state.doc.toString()

    const changes = prepareCodeChanges(currentDoc, newContent)

    if (changes && changes.length > 0) {
      const shouldScrollToBottom = autoScrollToBottom && !expanded && shouldStickToBottomRef.current
      editorViewRef.current.dispatch({
        changes,
        annotations: [Annotation.define<boolean>().of(true)],
        ...(shouldScrollToBottom
          ? {
              effects: EditorView.scrollIntoView(newContent.length, {
                y: 'end',
                x: 'nearest'
              })
            }
          : {})
      })
    }
  }, [autoScrollToBottom, expanded, options?.stream, value])

  const saveKeymapExtension = useSaveKeymap({ onSave, enabled: options?.keymap })
  const blurExtension = useBlurHandler({ onBlur })
  const heightListenerExtension = useHeightListener({ onHeightChange })

  const customExtensions = useMemo(() => {
    return [
      ...(extensions ?? []),
      ...langExtensions,
      ...(wrapped ? [EditorView.lineWrapping] : []),
      codeEditorGutterTheme,
      saveKeymapExtension,
      blurExtension,
      heightListenerExtension
    ].flat()
  }, [extensions, langExtensions, wrapped, saveKeymapExtension, blurExtension, heightListenerExtension])

  const scrollToLine = useScrollToLine(editorViewRef)

  useEffect(() => {
    if (!autoScrollToBottom || expanded || !shouldStickToBottomRef.current || !editorViewRef.current) return

    scrollToDocumentBottom(editorViewRef.current)
  }, [autoScrollToBottom, expanded, scrollToDocumentBottom])

  useEffect(() => {
    return () => {
      scrollCleanupRef.current?.()
      scrollCleanupRef.current = null
    }
  }, [])

  useImperativeHandle(ref, () => ({
    save: handleSave,
    getContent: () => editorViewRef.current?.state.doc.toString() ?? '',
    scrollToLine,
    insertText,
    focus
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
        scrollCleanupRef.current?.()
        editorViewRef.current = view
        onHeightChange?.(view.scrollDOM?.scrollHeight ?? 0)
        const scrollElement = view.scrollDOM
        const handleScroll = () => {
          if (autoScrollToBottomRef.current && !expandedRef.current) {
            updateShouldStickToBottom(scrollElement)
          }
        }
        scrollElement.addEventListener('scroll', handleScroll, { passive: true })
        scrollCleanupRef.current = () => scrollElement.removeEventListener('scroll', handleScroll)
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
