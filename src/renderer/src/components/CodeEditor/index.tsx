import { MAX_COLLAPSED_CODE_HEIGHT } from '@renderer/config/constant'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import CodeMirror, { Annotation, BasicSetupOptions, EditorView, Extension } from '@uiw/react-codemirror'
import diff from 'fast-diff'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { memo } from 'react'

import { useBlurHandler, useHeightListener, useLanguageExtensions, useSaveKeymap } from './hooks'

// 标记非用户编辑的变更
const External = Annotation.define<boolean>()

export interface CodeEditorHandles {
  save?: () => void
}

interface CodeEditorProps {
  ref?: React.RefObject<CodeEditorHandles | null>
  value: string
  placeholder?: string | HTMLElement
  language: string
  onSave?: (newContent: string) => void
  onChange?: (newContent: string) => void
  onBlur?: (newContent: string) => void
  onHeightChange?: (scrollHeight: number) => void
  height?: string
  minHeight?: string
  maxHeight?: string
  fontSize?: string
  /** 用于覆写编辑器的某些设置 */
  options?: {
    stream?: boolean // 用于流式响应场景，默认 false
    lint?: boolean
    keymap?: boolean
  } & BasicSetupOptions
  /** 用于追加 extensions */
  extensions?: Extension[]
  /** 用于覆写编辑器的样式，会直接传给 CodeMirror 的 style 属性 */
  style?: React.CSSProperties
  className?: string
  editable?: boolean
  expanded?: boolean
  unwrapped?: boolean
}

/**
 * 源代码编辑器，基于 CodeMirror，封装了 ReactCodeMirror。
 *
 * 目前必须和 CodeToolbar 配合使用。
 */
const CodeEditor = ({
  ref,
  value,
  placeholder,
  language,
  onSave,
  onChange,
  onBlur,
  onHeightChange,
  height,
  minHeight,
  maxHeight,
  fontSize,
  options,
  extensions,
  style,
  className,
  editable = true,
  expanded = true,
  unwrapped = false
}: CodeEditorProps) => {
  const { fontSize: _fontSize, codeShowLineNumbers: _lineNumbers, codeEditor } = useSettings()
  const enableKeymap = useMemo(() => options?.keymap ?? codeEditor.keymap, [options?.keymap, codeEditor.keymap])

  // 合并 codeEditor 和 options 的 basicSetup，options 优先
  const customBasicSetup = useMemo(() => {
    return {
      lineNumbers: _lineNumbers,
      ...(codeEditor as BasicSetupOptions),
      ...(options as BasicSetupOptions)
    }
  }, [codeEditor, _lineNumbers, options])

  const customFontSize = useMemo(() => fontSize ?? `${_fontSize - 1}px`, [fontSize, _fontSize])

  const { activeCmTheme } = useCodeStyle()
  const initialContent = useRef(options?.stream ? (value ?? '').trimEnd() : (value ?? ''))
  const editorViewRef = useRef<EditorView | null>(null)

  const langExtensions = useLanguageExtensions(language, options?.lint)

  const handleSave = useCallback(() => {
    const currentDoc = editorViewRef.current?.state.doc.toString() ?? ''
    onSave?.(currentDoc)
  }, [onSave])

  // 流式响应过程中计算 changes 来更新 EditorView
  // 无法处理用户在流式响应过程中编辑代码的情况（应该也不必处理）
  useEffect(() => {
    if (!editorViewRef.current) return

    const newContent = options?.stream ? (value ?? '').trimEnd() : (value ?? '')
    const currentDoc = editorViewRef.current.state.doc.toString()

    const changes = prepareCodeChanges(currentDoc, newContent)

    if (changes && changes.length > 0) {
      editorViewRef.current.dispatch({
        changes,
        annotations: [External.of(true)]
      })
    }
  }, [options?.stream, value])

  const saveKeymapExtension = useSaveKeymap({ onSave, enabled: enableKeymap })
  const blurExtension = useBlurHandler({ onBlur })
  const heightListenerExtension = useHeightListener({ onHeightChange })

  const customExtensions = useMemo(() => {
    return [
      ...(extensions ?? []),
      ...langExtensions,
      ...(unwrapped ? [] : [EditorView.lineWrapping]),
      saveKeymapExtension,
      blurExtension,
      heightListenerExtension
    ].flat()
  }, [extensions, langExtensions, unwrapped, saveKeymapExtension, blurExtension, heightListenerExtension])

  useImperativeHandle(ref, () => ({
    save: handleSave
  }))

  return (
    <CodeMirror
      // 维持一个稳定值，避免触发 CodeMirror 重置
      value={initialContent.current}
      placeholder={placeholder}
      width="100%"
      height={height}
      minHeight={minHeight}
      maxHeight={expanded ? 'none' : (maxHeight ?? `${MAX_COLLAPSED_CODE_HEIGHT}px`)}
      editable={editable}
      // @ts-ignore 强制使用，见 react-codemirror 的 Example.tsx
      theme={activeCmTheme}
      extensions={customExtensions}
      onCreateEditor={(view: EditorView) => {
        editorViewRef.current = view
        onHeightChange?.(view.scrollDOM?.scrollHeight ?? 0)
      }}
      onChange={(value, viewUpdate) => {
        if (onChange && viewUpdate.docChanged) onChange(value)
      }}
      basicSetup={{
        dropCursor: true,
        allowMultipleSelections: true,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        rectangularSelection: true,
        crosshairCursor: true,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: true,
        closeBracketsKeymap: enableKeymap,
        searchKeymap: enableKeymap,
        foldKeymap: enableKeymap,
        completionKeymap: enableKeymap,
        lintKeymap: enableKeymap,
        ...customBasicSetup // override basicSetup
      }}
      style={{
        fontSize: customFontSize,
        marginTop: 0,
        borderRadius: 'inherit',
        ...style
      }}
      className={`code-editor ${className ?? ''}`}
    />
  )
}

CodeEditor.displayName = 'CodeEditor'

/**
 * 使用 fast-diff 计算代码变更，再转换为 CodeMirror 的 changes。
 * 可以处理所有类型的变更，不过流式响应过程中多是插入操作。
 * @param oldCode 旧的代码内容
 * @param newCode 新的代码内容
 * @returns 用于 EditorView.dispatch 的 changes 数组
 */
function prepareCodeChanges(oldCode: string, newCode: string) {
  const diffResult = diff(oldCode, newCode)

  const changes: { from: number; to: number; insert: string }[] = []
  let offset = 0

  // operation: 1=插入, -1=删除, 0=相等
  for (const [operation, text] of diffResult) {
    if (operation === 1) {
      changes.push({
        from: offset,
        to: offset,
        insert: text
      })
    } else if (operation === -1) {
      changes.push({
        from: offset,
        to: offset + text.length,
        insert: ''
      })
      offset += text.length
    } else {
      offset += text.length
    }
  }

  return changes
}

export default memo(CodeEditor)
