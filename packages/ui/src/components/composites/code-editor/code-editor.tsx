import { historyField } from '@codemirror/commands'
import { foldState, syntaxHighlighting } from '@codemirror/language'
import type { ChangeSpec } from '@codemirror/state'
import { EditorState, Text } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { gutters } from '@codemirror/view'
import type { BasicSetupOptions } from '@uiw/react-codemirror'
import CodeMirror, { ExternalChange, EditorView } from '@uiw/react-codemirror'
import { use, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { memo } from 'react'

import { loadCodeBlockLanguage } from '../../../code-block'
import { useBlurHandler, useHeightListener, useLanguageExtensions, useSaveKeymap, useScrollToLine } from './hooks'
import type { CodeEditorProps } from './types'
import { prepareCodeChanges } from './utils'

function toDocumentText(source: string): Text {
  return Text.of(source.split(/\r\n?|\n/))
}

const codeEditorLineBreakFilter = EditorState.transactionFilter.of((transaction) => {
  const changes: ChangeSpec[] = []
  transaction.changes.iterChanges((_from, _to, from, to, inserted) => {
    const normalized = toDocumentText(inserted.toString())
    if (!inserted.eq(normalized)) changes.push({ from, to, insert: normalized })
  })
  return changes.length ? [transaction, { changes, sequential: true }] : transaction
})

const codeEditorGutterTheme = EditorView.theme({
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: 'var(--muted-foreground)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent'
  }
})

/**
 * A code editor component based on CodeMirror.
 * This is a wrapper of ReactCodeMirror.
 */
const CodeEditor = ({
  ref,
  stateRef,
  syntaxHighlightStyle,
  value,
  placeholder,
  autoFocus,
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

  const initialContent = useRef(options?.stream && !syntaxHighlightStyle ? (value ?? '').trimEnd() : (value ?? ''))
  const lineBreak = initialContent.current.includes('\r\n') ? '\r\n' : '\n'
  const [initialState] = useState(() => {
    const retained = stateRef?.current
    const state =
      retained?.sliceDoc() === initialContent.current
        ? retained
        : EditorState.create({
            doc: toDocumentText(initialContent.current),
            extensions: [EditorState.lineSeparator.of(lineBreak)]
          })
    return {
      json: state.toJSON({ history: historyField, folds: foldState }),
      fields: { history: historyField, folds: foldState }
    }
  })
  const editorViewRef = useRef<EditorView | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const autoScrollToBottomRef = useRef(autoScrollToBottom)
  const expandedRef = useRef(expanded)
  const scrollCleanupRef = useRef<(() => void) | null>(null)

  const langExtensions = useLanguageExtensions(language, options?.lint, languageConfig)

  const handleSave = useCallback(() => {
    const currentDoc = editorViewRef.current?.state.sliceDoc() ?? ''
    onSave?.(currentDoc)
  }, [onSave])

  const insertText = useCallback((text: string) => {
    const editorView = editorViewRef.current
    if (!editorView) return false

    editorView.dispatch(editorView.state.replaceSelection(text))
    editorView.focus()
    return true
  }, [])

  const getSelection = useCallback(() => {
    const editorView = editorViewRef.current
    if (!editorView) return null
    const { from, to } = editorView.state.selection.main
    return { from, to, text: editorView.state.sliceDoc(from, to) }
  }, [])

  const replaceRange = useCallback((range: { from: number; to: number }, text: string) => {
    const editorView = editorViewRef.current
    if (
      !editorView ||
      !editorView.state.facet(EditorView.editable) ||
      editorView.state.readOnly ||
      !Number.isInteger(range.from) ||
      !Number.isInteger(range.to) ||
      range.from < 0 ||
      range.to < range.from ||
      range.to > editorView.state.doc.length
    ) {
      return false
    }

    const insert = editorView.state.toText(text)
    editorView.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + insert.length }
    })
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

    const newContent = options?.stream && !syntaxHighlightStyle ? (value ?? '').trimEnd() : (value ?? '')
    // Serialized CRLF strings have different offsets from CodeMirror's single-position line breaks.
    const currentDoc = editorViewRef.current.state.doc.toString()
    const nextDoc = toDocumentText(newContent)
    const changes = prepareCodeChanges(currentDoc, nextDoc.toString()).map((change) => ({
      ...change,
      insert: toDocumentText(change.insert)
    }))

    if (changes && changes.length > 0) {
      const shouldScrollToBottom = autoScrollToBottom && !expanded && shouldStickToBottomRef.current
      editorViewRef.current.dispatch({
        changes,
        annotations: [ExternalChange.of(true)],
        ...(shouldScrollToBottom
          ? {
              effects: EditorView.scrollIntoView(nextDoc.length, {
                y: 'end',
                x: 'nearest'
              })
            }
          : {})
      })
    }
  }, [autoScrollToBottom, expanded, options?.stream, value, syntaxHighlightStyle])

  const saveKeymapExtension = useSaveKeymap({ onSave, enabled: options?.keymap })
  const blurExtension = useBlurHandler({ onBlur })
  const heightListenerExtension = useHeightListener({ onHeightChange })

  const customExtensions = useMemo(() => {
    return [
      ...(extensions ?? []),
      EditorState.lineSeparator.of(lineBreak),
      codeEditorLineBreakFilter,
      // Line numbers scroll with the code, matching the message viewer; a sticky gutter overlaps it.
      ...(syntaxHighlightStyle
        ? [syntaxHighlighting(syntaxHighlightStyle), EditorState.tabSize.of(2), gutters({ fixed: false })]
        : []),
      ...langExtensions,
      ...(wrapped ? [EditorView.lineWrapping] : []),
      codeEditorGutterTheme,
      saveKeymapExtension,
      blurExtension,
      heightListenerExtension
    ].flat()
  }, [
    extensions,
    langExtensions,
    wrapped,
    saveKeymapExtension,
    blurExtension,
    heightListenerExtension,
    syntaxHighlightStyle,
    lineBreak
  ])

  const sharedTheme = useMemo(
    () =>
      EditorView.theme(
        {
          '&': { backgroundColor: 'transparent', color: 'var(--code-foreground)' },
          '.cm-scroller': { fontFamily: 'var(--code-font-family)', lineHeight: `${Math.round(fontSize * 1.6)}px` },
          '.cm-scroller .cm-content': {
            padding: `${Math.round(fontSize / 2)}px 1em`,
            lineHeight: 'inherit',
            caretColor: 'var(--code-caret)'
          },
          '.cm-line': { padding: '0' },
          '.cm-scroller:has(.cm-gutters) .cm-content': { paddingLeft: '0' },
          '.cm-scroller .cm-gutters': {
            lineHeight: 'inherit',
            padding: '0 0 0 1em',
            backgroundColor: 'transparent',
            border: 'none',
            color: 'var(--code-foreground)'
          },
          '.cm-lineNumbers .cm-gutterElement': {
            padding: '0',
            minWidth: '0',
            opacity: '0.35',
            marginRight: '1rem',
            fontVariantNumeric: 'tabular-nums'
          },
          '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--code-selection) 35%, transparent)' },
          '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
            backgroundColor: 'var(--code-selection)'
          },
          '.cm-cursor': { borderLeftColor: 'var(--code-caret)' },
          '.cm-panels': { color: 'var(--code-foreground)', backgroundColor: 'var(--code-background)' }
        },
        { dark: theme === 'dark' }
      ),
    [theme, fontSize]
  )
  const handleUpdate = useCallback(
    (update: ViewUpdate) => {
      if (stateRef) stateRef.current = update.state
    },
    [stateRef]
  )

  const scrollToLine = useScrollToLine(editorViewRef)

  useEffect(() => {
    if (!autoScrollToBottom || expanded || !shouldStickToBottomRef.current || !editorViewRef.current) return

    scrollToDocumentBottom(editorViewRef.current)
  }, [autoScrollToBottom, expanded, scrollToDocumentBottom])

  useEffect(() => {
    return () => {
      scrollCleanupRef.current?.()
      scrollCleanupRef.current = null
      editorViewRef.current = null
    }
  }, [])

  useImperativeHandle(ref, () => ({
    save: handleSave,
    getContent: () => editorViewRef.current?.state.sliceDoc() ?? '',
    getSelection,
    replaceRange,
    scrollToLine,
    insertText,
    focus
  }))

  return (
    <CodeMirror
      // Set to a stable value to avoid triggering CodeMirror reset
      value={String(initialState.json.doc).replaceAll('\r\n', '\n')}
      placeholder={placeholder}
      autoFocus={autoFocus}
      width="100%"
      height={expanded ? undefined : height}
      maxHeight={expanded ? undefined : maxHeight}
      minHeight={minHeight}
      editable={editable}
      readOnly={readOnly}
      theme={syntaxHighlightStyle ? sharedTheme : theme}
      initialState={initialState}
      onUpdate={handleUpdate}
      extensions={customExtensions}
      onCreateEditor={(view: EditorView) => {
        scrollCleanupRef.current?.()
        editorViewRef.current = view
        if (stateRef) stateRef.current = view.state
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
      onChange={(_value, viewUpdate) => {
        if (onChange && viewUpdate.docChanged) onChange(viewUpdate.state.sliceDoc())
      }}
      basicSetup={basicSetup}
      style={{
        fontSize,
        marginTop: 0,
        borderRadius: 'inherit',
        // ReactCodeMirror only sizes .cm-editor, so a percentage height collapses to
        // auto unless this host element carries the same height.
        ...(expanded ? undefined : { height }),
        ...style
      }}
      className={`code-editor ${className ?? ''}`}
    />
  )
}

CodeEditor.displayName = 'CodeEditor'

export function SharedSyntaxEditor(props: CodeEditorProps) {
  const language = use(loadCodeBlockLanguage(props.language, props.languageConfig))
  const extensions = useMemo(
    () => (language ? [language, ...(props.extensions ?? [])] : props.extensions),
    [language, props.extensions]
  )
  return <CodeEditor {...props} extensions={extensions} />
}

export default memo(CodeEditor)
