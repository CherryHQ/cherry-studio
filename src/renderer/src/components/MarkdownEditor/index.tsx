import 'katex/dist/katex.min.css'

import React, { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import styled from 'styled-components'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  height?: string | number
  autoFocus?: boolean
}

const MarkdownEditor: FC<MarkdownEditorProps> = ({
  value,
  onChange,
  placeholder = '请输入Markdown格式文本...',
  height = '300px',
  autoFocus = false
}) => {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState(value || '')

  useEffect(() => {
    setInputValue(value || '')
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
    onChange(newValue)
  }

  return (
    <EditorContainer style={{ height }}>
      <InputArea value={inputValue} onChange={handleChange} placeholder={placeholder} autoFocus={autoFocus} />
      <PreviewArea className="markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkMath]}
          rehypePlugins={[rehypeRaw, rehypeKatex]}>
          {inputValue || t('settings.provider.notes.markdown_editor_default_value')}
        </ReactMarkdown>
      </PreviewArea>
    </EditorContainer>
  )
}

const EditorContainer = styled.div`
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
`

const InputArea = styled.textarea`
  flex: 1;
  padding: 12px;
  border: none;
  resize: none;
  font-family: var(--font-family);
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text);
  background-color: var(--color-bg-1);
  border-right: 1px solid var(--color-border);
  outline: none;

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: var(--color-text-3);
  }
`

const PreviewArea = styled.div`
  flex: 1;
  padding: 12px;
  overflow: auto;
  background-color: var(--color-bg-1);
`

export default MarkdownEditor
