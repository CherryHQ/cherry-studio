import { TOOL_SPECS, useCodeToolbar } from '@renderer/components/CodeToolbar'
import { useCodeStyle } from '@renderer/context/CodeStyleProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import CodeMirror, { Annotation, EditorView, Extension, keymap } from '@uiw/react-codemirror'
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

// 标记非用户编辑的变更
const External = Annotation.define<boolean>()

interface Props {
  children: string
  language: string
  onSave?: (newContent: string) => void
  onChange?: (newContent: string) => void
  // options used to override the default behaviour
  options?: {
    maxHeight?: string
  }
}

/**
 * 源代码编辑器，基于 CodeMirror
 *
 * 目前必须和 CodeToolbar 配合使用。
 */
const CodeEditor = ({ children, language, onSave, onChange, options }: Props) => {
  const { fontSize, codeShowLineNumbers, codeCollapsible, codeWrappable, codeEditor } = useSettings()
  const { activeCmTheme, languageMap } = useCodeStyle()
  const [isExpanded, setIsExpanded] = useState(!codeCollapsible)
  const [isUnwrapped, setIsUnwrapped] = useState(!codeWrappable)
  const initialContent = useRef(children?.trimEnd() ?? '')
  const [langExtension, setLangExtension] = useState<Extension[]>([])
  const [editorReady, setEditorReady] = useState(false)
  const editorViewRef = useRef<EditorView | null>(null)
  const { t } = useTranslation()

  const { registerTool, removeTool } = useCodeToolbar()

  // 加载语言
  useEffect(() => {
    let normalizedLang = languageMap[language as keyof typeof languageMap] || language.toLowerCase()

    // 如果语言名包含 `-`，转换为驼峰命名法
    if (normalizedLang.includes('-')) {
      normalizedLang = normalizedLang.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
    }

    import('@uiw/codemirror-extensions-langs')
      .then(({ loadLanguage }) => {
        const extension = loadLanguage(normalizedLang as any)
        if (extension) {
          setLangExtension([extension])
        }
      })
      .catch((error) => {
        console.debug(`Failed to load language: ${normalizedLang}`, error)
      })
  }, [language, languageMap])

  // 展开/折叠工具
  useEffect(() => {
    registerTool({
      ...TOOL_SPECS.expand,
      icon: isExpanded ? <ChevronsDownUp className="icon" /> : <ChevronsUpDown className="icon" />,
      tooltip: isExpanded ? t('code_block.collapse') : t('code_block.expand'),
      visible: () => {
        const scrollHeight = editorViewRef?.current?.scrollDOM?.scrollHeight
        return codeCollapsible && (scrollHeight ?? 0) > 350
      },
      onClick: () => setIsExpanded((prev) => !prev)
    })

    return () => removeTool(TOOL_SPECS.expand.id)
  }, [codeCollapsible, isExpanded, registerTool, removeTool, t, editorReady])

  // 自动换行工具
  useEffect(() => {
    registerTool({
      ...TOOL_SPECS.wrap,
      icon: isUnwrapped ? <WrapIcon className="icon" /> : <UnWrapIcon className="icon" />,
      tooltip: isUnwrapped ? t('code_block.wrap.on') : t('code_block.wrap.off'),
      visible: () => codeWrappable,
      onClick: () => setIsUnwrapped((prev) => !prev)
    })

    return () => removeTool(TOOL_SPECS.wrap.id)
  }, [codeWrappable, isUnwrapped, registerTool, removeTool, t])

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

    const newContent = children?.trimEnd() ?? ''
    const currentDoc = editorViewRef.current.state.doc.toString()

    const changes = prepareCodeChanges(currentDoc, newContent)

    if (changes && changes.length > 0) {
      editorViewRef.current.dispatch({
        changes,
        annotations: [External.of(true)]
      })
    }
  }, [children])

  useEffect(() => {
    setIsExpanded(!codeCollapsible)
  }, [codeCollapsible])

  useEffect(() => {
    setIsUnwrapped(!codeWrappable)
  }, [codeWrappable])

  // 保存功能的快捷键
  const saveKeymap = useMemo(() => {
    return keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          handleSave()
          return true
        },
        preventDefault: true
      }
    ])
  }, [handleSave])

  const enabledExtensions = useMemo(() => {
    return [
      ...langExtension,
      ...(isUnwrapped ? [] : [EditorView.lineWrapping]),
      ...(codeEditor.keymap ? [saveKeymap] : [])
    ]
  }, [codeEditor.keymap, langExtension, isUnwrapped, saveKeymap])

  return (
    <CodeMirror
      // 维持一个稳定值，避免触发 CodeMirror 重置
      value={initialContent.current}
      width="100%"
      maxHeight={codeCollapsible && !isExpanded ? (options?.maxHeight ?? '350px') : 'none'}
      editable={true}
      // @ts-ignore 强制使用，见 react-codemirror 的 Example.tsx
      theme={activeCmTheme}
      extensions={enabledExtensions}
      onCreateEditor={(view: EditorView) => {
        editorViewRef.current = view
        setEditorReady(true)
      }}
      onChange={(value, viewUpdate) => {
        if (onChange && viewUpdate.docChanged) onChange(value)
      }}
      basicSetup={{
        lineNumbers: codeShowLineNumbers,
        highlightActiveLineGutter: codeEditor.highlightActiveLine,
        foldGutter: codeEditor.foldGutter,
        dropCursor: true,
        allowMultipleSelections: true,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: codeEditor.autocompletion,
        rectangularSelection: true,
        crosshairCursor: true,
        highlightActiveLine: codeEditor.highlightActiveLine,
        highlightSelectionMatches: true,
        closeBracketsKeymap: codeEditor.keymap,
        searchKeymap: codeEditor.keymap,
        foldKeymap: codeEditor.keymap,
        completionKeymap: codeEditor.keymap,
        lintKeymap: codeEditor.keymap
      }}
      style={{
        fontSize: `${fontSize - 1}px`,
        overflow: codeCollapsible && !isExpanded ? 'auto' : 'visible',
        position: 'relative',
        border: '0.5px solid var(--color-code-background)',
        borderRadius: '5px',
        marginTop: 0
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
