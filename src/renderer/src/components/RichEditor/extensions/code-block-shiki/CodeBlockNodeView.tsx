import { CopyOutlined } from '@ant-design/icons'
import { DEFAULT_LANGUAGES, getHighlighter, getShiki } from '@renderer/utils/shiki'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react'
import { Button, Select, Tooltip } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'

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
        <Tooltip title="Copy">
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            className="code-block-copy-btn"
            onClick={handleCopy}
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
