import { ExpandAltOutlined, SaveOutlined, ShrinkOutlined } from '@ant-design/icons'
import { useToolbar } from '@renderer/components/CodeView/context'
import UnWrapIcon from '@renderer/components/Icons/UnWrapIcon'
import WrapIcon from '@renderer/components/Icons/WrapIcon'
import { useCodeThemes } from '@renderer/hooks/useCodeThemes'
import { useSettings } from '@renderer/hooks/useSettings'
import { langs } from '@uiw/codemirror-extensions-langs'
import * as cmThemes from '@uiw/codemirror-themes-all'
import CodeMirror, { EditorView, Extension, ReactCodeMirrorProps } from '@uiw/react-codemirror'
import { useEffect, useMemo, useRef, useState } from 'react'
import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  children: string
  language: string
}

const SourceEditor = ({ children, language, ref }: Props & { ref?: React.RefObject<HTMLDivElement | null> }) => {
  const { fontSize, codeShowLineNumbers, codeCollapsible, codeWrappable, codeEditor } = useSettings()
  const { currentTheme } = useCodeThemes()
  const [isExpanded, setIsExpanded] = useState(!codeCollapsible)
  const [isUnwrapped, setIsUnwrapped] = useState(!codeWrappable)
  const [code, setCode] = useState(children)
  const [extensions, setExtensions] = useState<Extension[]>([])
  const editorRef = useRef<HTMLDivElement>(null)
  const [showExpandButton, setShowExpandButton] = useState(false)
  const showExpandButtonRef = useRef(false)
  const { t } = useTranslation()

  // 合并引用
  React.useImperativeHandle(ref, () => editorRef.current!, [])

  const { registerTool, removeTool } = useToolbar()

  const languageMap = useMemo(() => {
    return {
      bash: 'shell',
      svg: 'xml',
      vab: 'vb'
    } as Record<string, string>
  }, [])

  // 动态加载语言支持
  useEffect(() => {
    const normalizedLang = languageMap[language as keyof typeof languageMap] || language.toLowerCase()

    if (normalizedLang in langs) {
      setExtensions([langs[normalizedLang as keyof typeof langs]()])
    } else {
      console.log(`Failed to load language: ${language}`)
      setExtensions([])
    }
  }, [language, languageMap])

  // 展开/折叠工具
  useEffect(() => {
    registerTool({
      id: 'expand',
      type: 'quick',
      icon: isExpanded ? <ShrinkOutlined /> : <ExpandAltOutlined />,
      tooltip: isExpanded ? t('code_block.collapse') : t('code_block.expand'),
      condition: () => codeCollapsible && showExpandButton,
      onClick: () => {
        const newExpanded = !isExpanded
        setIsExpanded(newExpanded)
      },
      order: 1
    })

    return () => removeTool('expand')
  }, [codeCollapsible, isExpanded, registerTool, removeTool, showExpandButton, t])

  // 自动换行工具
  useEffect(() => {
    registerTool({
      id: 'wrap',
      type: 'quick',
      icon: isUnwrapped ? <WrapIcon /> : <UnWrapIcon />,
      tooltip: isUnwrapped ? t('code_block.wrap.on') : t('code_block.wrap.off'),
      condition: () => codeWrappable,
      onClick: () => {
        const newUnwrapped = !isUnwrapped
        setIsUnwrapped(newUnwrapped)
      },
      order: 0
    })

    return () => removeTool('wrap')
  }, [codeWrappable, isUnwrapped, registerTool, removeTool, t])

  // 保存按钮
  useEffect(() => {
    const hasChanges = code !== children

    registerTool({
      id: 'save',
      type: 'core',
      icon: <SaveOutlined />,
      tooltip: t('code_block.edit.save'),
      condition: () => hasChanges, // 只有在内容变更时才显示
      onClick: () => {
        console.log('Save code:', code)
        // TODO: 调用消息更新逻辑
      },
      order: 3
    })

    return () => removeTool('save')
  }, [code, children, registerTool, removeTool, t])

  // 检查编辑器高度并决定是否显示展开按钮
  useEffect(() => {
    if (!editorRef.current) return

    // 等待 DOM 更新完成后检查高度
    setTimeout(() => {
      const editorElement = editorRef.current?.querySelector('.cm-editor')
      if (!editorElement) return

      const isShowExpandButton = editorElement.scrollHeight > 350
      if (showExpandButtonRef.current === isShowExpandButton) return

      showExpandButtonRef.current = isShowExpandButton
      setShowExpandButton(isShowExpandButton)
    }, 100)
  }, [])

  useEffect(() => {
    setIsExpanded(!codeCollapsible)
  }, [codeCollapsible])

  useEffect(() => {
    setIsUnwrapped(!codeWrappable)
  }, [codeWrappable])

  const cmTheme = useMemo(() => {
    const _cmTheme = currentTheme as ReactCodeMirrorProps['theme']
    return cmThemes[_cmTheme as keyof typeof cmThemes]
  }, [currentTheme])

  return (
    <CodemirrorWarpper ref={editorRef}>
      <CodeMirror
        value={children}
        width="100%"
        maxHeight={codeCollapsible && !isExpanded ? '350px' : 'none'}
        editable={true}
        // @ts-ignore 强制使用，见 https://github.com/uiwjs/react-codemirror/blob/master/www/src/pages/home/Example.tsx
        theme={cmTheme}
        extensions={[...extensions, ...(isUnwrapped ? [] : [EditorView.lineWrapping])]}
        onChange={(value) => setCode(value)}
        basicSetup={{
          lineNumbers: codeShowLineNumbers,
          highlightActiveLineGutter: codeEditor.highlightActiveLine,
          foldGutter: false,
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
          overflow: codeCollapsible && !isExpanded ? 'auto' : 'visible'
        }}
      />
    </CodemirrorWarpper>
  )
}

SourceEditor.displayName = 'SourceEditor'

const CodemirrorWarpper = styled.div`
  position: relative;
  height: 100%;
  width: 100%;
  border: 0.5px solid var(--color-code-background);
  margin-top: 0;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
`

export default memo(SourceEditor)
