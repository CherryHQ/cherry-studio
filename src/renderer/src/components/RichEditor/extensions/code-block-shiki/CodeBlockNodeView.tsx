import { CopyOutlined } from '@ant-design/icons'
import { Button, Tooltip } from '@cherrystudio/ui'
import { DEFAULT_LANGUAGES, getHighlighter, getShiki } from '@renderer/utils/shiki'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react'
import { Select } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'

const CodeBlockNodeView: FC<ReactNodeViewProps> = (props) => {
  const { node, updateAttributes } = props
  const [languageOptions, setLanguageOptions] = useState<string[]>(DEFAULT_LANGUAGES)

  // Detect language from node attrs or fallback
  const language = (node.attrs.language as string) || 'text'

  // Build language options with 'text' always available
  useEffect(() => {
    const loadLanguageOptions = async () => {
      try {
        const shiki = await getShiki()
        const highlighter = await getHighlighter()

        // Get bundled languages from shiki
        const bundledLanguages = Object.keys(shiki.bundledLanguages)

        // Combine with loaded languages
        const loadedLanguages = highlighter.getLoadedLanguages()

        const allLanguages = Array.from(new Set(['text', ...bundledLanguages, ...loadedLanguages]))

        setLanguageOptions(allLanguages)
      } catch {
        setLanguageOptions(DEFAULT_LANGUAGES)
      }
    }

    loadLanguageOptions()
  }, [])

  // Handle language change
  const handleLanguageChange = useCallback(
    (value: string) => {
      updateAttributes({ language: value })
    },
    [updateAttributes]
  )

  // Handle copy code block content
  const handleCopy = useCallback(async () => {
    const codeText = props.node.textContent || ''
    try {
      await navigator.clipboard.writeText(codeText)
    } catch {
      // Clipboard may fail (e.g. non-secure context)
    }
  }, [props.node.textContent])

  return (
    <NodeViewWrapper className="code-block-wrapper">
      <div className="code-block-header">
        <Select
          size="small"
          className="code-block-language-select"
          value={language}
          onChange={handleLanguageChange}
          options={languageOptions.map((lang) => ({ value: lang, label: lang }))}
          style={{ minWidth: 90 }}
        />
        <Tooltip placement="top" content="Copy">
          <Button
            size="sm"
            variant="light"
            startContent={<CopyOutlined />}
            isIconOnly
            className="code-block-copy-btn"
            onPress={handleCopy}
          />
        </Tooltip>
      </div>
      <pre className={`language-${language}`}>
        {/* TipTap will render the editable code content here */}
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}

export const CodeBlockNodeReactRenderer = ReactNodeViewRenderer(CodeBlockNodeView)

export default CodeBlockNodeView
