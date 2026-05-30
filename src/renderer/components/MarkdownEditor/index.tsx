import 'katex/dist/katex.min.css'

import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

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
    <div className="flex w-full overflow-hidden rounded-lg border border-[var(--color-border)]" style={{ height }}>
      <textarea
        className="flex-1 resize-none border-0 border-[var(--color-border)] border-r bg-background p-3 font-[var(--font-family)] text-foreground text-sm leading-[1.5] outline-none placeholder:text-foreground-muted focus:outline-none"
        value={inputValue}
        onChange={handleChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <div className="markdown flex-1 overflow-auto bg-background p-3">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkMath]}
          rehypePlugins={[rehypeRaw, rehypeKatex]}>
          {inputValue || t('settings.provider.notes.markdown_editor_default_value')}
        </ReactMarkdown>
      </div>
    </div>
  )
}

export default MarkdownEditor
