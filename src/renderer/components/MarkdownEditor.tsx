import '@cherrystudio/ui/components/composites/markdown/styles'
import '@renderer/assets/styles/vendor/katex.css'

import { defaultMarkdownPlugins, Markdown, withMath } from '@cherrystudio/ui'
import type { FC } from 'react'
import { memo, useDeferredValue, useId } from 'react'
import { useTranslation } from 'react-i18next'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  height?: string | number
  autoFocus?: boolean
}

interface MarkdownPreviewProps {
  id: string
  value: string
  fallback: string
}

const MarkdownPreview = memo(({ id, value, fallback }: MarkdownPreviewProps) => (
  <div className="markdown flex-1 overflow-auto bg-background p-3">
    <Markdown id={id} plugins={{ cjk: defaultMarkdownPlugins.cjk, math: withMath() }}>
      {value || fallback}
    </Markdown>
  </div>
))

const MarkdownEditor: FC<MarkdownEditorProps> = ({
  value,
  onChange,
  placeholder = '请输入Markdown格式文本...',
  height = '300px',
  autoFocus = false
}) => {
  const { t } = useTranslation()
  const markdownId = useId()
  const deferredValue = useDeferredValue(value)

  return (
    <div className="flex w-full overflow-hidden rounded-lg border border-border" style={{ height }}>
      <textarea
        className="flex-1 resize-none border-0 border-border border-r bg-background p-3 font-[var(--font-family)] text-foreground text-sm leading-[1.5] outline-none placeholder:text-muted-foreground focus:outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <MarkdownPreview
        id={markdownId}
        value={deferredValue}
        fallback={t('settings.provider.notes.markdown_editor_default_value')}
      />
    </div>
  )
}

export default MarkdownEditor
