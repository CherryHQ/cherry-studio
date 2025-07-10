import { CodeTool, TOOL_SPECS, useCodeTool } from '@renderer/components/CodeToolbar'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import CodeMirror, { Annotation, BasicSetupOptions, EditorView, Extension } from '@uiw/react-codemirror'
import diff from 'fast-diff'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Save as SaveIcon,
  Text as UnWrapIcon,
  WrapText as WrapIcon
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { useBlurHandler, useLanguageExtensions, useSaveKeymap } from './hooks'

// 标记非用户编辑的变更
const External = Annotation.define<boolean>()

interface Props {
  value: string
  placeholder?: string | HTMLElement
  language: string
  onSave?: (newContent: string) => void
  onChange?: (newContent: string) => void
  onBlur?: (newContent: string) => void
  setTools?: (value: React.SetStateAction<CodeTool[]>) => void
  height?: string
  minHeight?: string
  maxHeight?: string
  /** 用于覆写编辑器的某些设置 */
  options?: {
    stream?: boolean // 用于流式响应场景，默认 false
    lint?: boolean
    collapsible?: boolean
    wrappable?: boolean
    keymap?: boolean
  } & BasicSetupOptions
  /** 用于追加 extensions */
  extensions?: Extension[]
  /** 用于覆写编辑器的样式，会直接传给 CodeMirror 的 style 属性 */
  style?: React.CSSProperties
  editable?: boolean
}

/**
 * 源代码编辑器，基于 CodeMirror，封装了 ReactCodeMirror。
 *
 * 目前必须和 CodeToolbar 配合使用。
 */
const CodeEditor = ({
  value,
  placeholder,
  language,
  onSave,
  onChange,
  onBlur,
  setTools,
  height,
  minHeight,
  maxHeight,
  options,
  extensions,
  style,
  editable = true
}: Props) => {
  const {
    fontSize,
    codeShowLineNumbers: _lineNumbers,
    codeCollapsible: _collapsible,
    codeWrappable: _wrappable,
    codeEditor
  } = useSettings()
  const collapsible = useMemo(() => options?.collapsible ?? _collapsible, [options?.collapsible, _collapsible])
  const wrappable = useMemo(() => options?.wrappable ?? _wrappable, [options?.wrappable, _wrappable])
  const enableKeymap = useMemo(() => options?.keymap ?? codeEditor.keymap, [options?.keymap, codeEditor.keymap])

  // 合并 codeEditor 和 options 的 basicSetup，options 优先
  const customBasicSetup = useMemo(() => {
    return {
      lineNumbers: _lineNumbers,
      ...(codeEditor as BasicSetupOptions),
      ...(options as BasicSetupOptions)
    }
  }, [codeEditor, _lineNumbers, options])

  const { activeCmTheme } = useCodeStyle()
  const [isExpanded, setIsExpanded] = useState(!collapsible)
  const [isUnwrapped, setIsUnwrapped] = useState(!wrappable)
  const initialContent = useRef(options?.stream ? (value ?? '').trimEnd() : (value ?? ''))
  const [editorReady, setEditorReady] = useState(false)
  const editorViewRef = useRef<EditorView | null>(null)
  const { t } = useTranslation()

  const langExtensions = useLanguageExtensions(language, options?.lint)

  const { registerTool, removeTool } = useCodeTool(setTools)

  // 展开/折叠工具
  useEffect(() => {
    registerTool({
      ...TOOL_SPECS.expand,
      icon: isExpanded ? <ChevronsDownUp className="icon" /> : <ChevronsUpDown className="icon" />,
      tooltip: isExpanded ? t('code_block.collapse') : t('code_block.expand'),
      visible: () => {
        const scrollHeight = editorViewRef?.current?.scrollDOM?.scrollHeight
        return collapsible && (scrollHeight ?? 0) > 350
      },
      onClick: () => setIsExpanded((prev) => !prev)
    })

    return () => removeTool(TOOL_SPECS.expand.id)
  }, [collapsible, isExpanded, registerTool, removeTool, t, editorReady])

  // 自动换行工具
  useEffect(() => {
    registerTool({
      ...TOOL_SPECS.wrap,
      icon: isUnwrapped ? <WrapIcon className="icon" /> : <UnWrapIcon className="icon" />,
      tooltip: isUnwrapped ? t('code_block.wrap.on') : t('code_block.wrap.off'),
      visible: () => wrappable,
      onClick: () => setIsUnwrapped((prev) => !prev)
    })

    return () => removeTool(TOOL_SPECS.wrap.id)
  }, [wrappable, isUnwrapped, registerTool, removeTool, t])

  const handleSave = useCallback(() => {
    const currentDoc = editorViewRef.current?.state.doc.toString() ?? ''
    onSave?.(currentDoc)
  }, [onSave])

  // 保存按钮
  useEffect(() => {
    registerTool({
      ...TOOL_SPECS.save,
      icon: <SaveIcon className="icon" />,
      tooltip: t('code_block.edit.save'),
      onClick: handleSave
    })

    return () => removeTool(TOOL_SPECS.save.id)
  }, [handleSave, registerTool, removeTool, t])

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

  useEffect(() => {
    setIsExpanded(!collapsible)
  }, [collapsible])

  useEffect(() => {
    setIsUnwrapped(!wrappable)
  }, [wrappable])

  const saveKeymapExtension = useSaveKeymap({ onSave, enabled: enableKeymap })
  const blurExtension = useBlurHandler({ onBlur })

  const customExtensions = useMemo(() => {
    return [
      ...(extensions ?? []),
      ...langExtensions,
      ...(isUnwrapped ? [] : [EditorView.lineWrapping]),
      saveKeymapExtension,
      blurExtension
    ].flat()
  }, [extensions, langExtensions, isUnwrapped, saveKeymapExtension, blurExtension])

  return (
    <CodeMirror
      // 维持一个稳定值，避免触发 CodeMirror 重置
      value={initialContent.current}
      placeholder={placeholder}
      width="100%"
      height={height}
      minHeight={minHeight}
      maxHeight={collapsible && !isExpanded ? (maxHeight ?? '350px') : 'none'}
      editable={editable}
      // @ts-ignore 强制使用，见 react-codemirror 的 Example.tsx
      theme={activeCmTheme}
      extensions={customExtensions}
      onCreateEditor={(view: EditorView) => {
        editorViewRef.current = view
        setEditorReady(true)
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
        fontSize: `${fontSize - 1}px`,
        marginTop: 0,
        borderRadius: 'inherit',
        ...style
      }}
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
