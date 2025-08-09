import { CopyOutlined } from '@ant-design/icons'
import { DEFAULT_LANGUAGES, getHighlighter } from '@renderer/utils/shiki'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react'
import { Button, Select, Tooltip } from 'antd'
import { FC, useCallback, useMemo } from 'react'

const CodeBlockNodeView: FC<ReactNodeViewProps> = (props) => {
  const { node, updateAttributes } = props

  // Detect language from node attrs or fallback
  const language = (node.attrs.language as string) || 'text'

  // Build language options with 'text' always available
  const languageOptions: string[] = useMemo(() => {
    let options = DEFAULT_LANGUAGES

    getHighlighter().then((highlighter) => {
      if (highlighter && typeof highlighter.getLoadedLanguages === 'function') {
        try {
          options = Array.from(new Set(['text', ...highlighter.getLoadedLanguages()]))
        } catch {
          options = DEFAULT_LANGUAGES
        }
      }
    })

    return options
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
