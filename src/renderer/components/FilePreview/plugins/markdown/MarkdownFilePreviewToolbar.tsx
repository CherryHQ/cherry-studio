import { Code2, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { FilePreviewModeTabs } from '../../FilePreviewToolbar'

export type MarkdownFilePreviewMode = 'preview' | 'source'

interface MarkdownFilePreviewToolbarProps {
  disabled: boolean
  mode: MarkdownFilePreviewMode
  onModeChange: (mode: MarkdownFilePreviewMode) => void
}

export function MarkdownFilePreviewToolbar({ disabled, mode, onModeChange }: MarkdownFilePreviewToolbarProps) {
  const { t } = useTranslation()

  return (
    <FilePreviewModeTabs<MarkdownFilePreviewMode>
      aria-label={t('file_preview.markdown.mode.label')}
      disabled={disabled}
      value={mode}
      onValueChange={onModeChange}
      options={[
        { value: 'source', label: t('file_preview.markdown.mode.source'), icon: <Code2 size={14} /> },
        { value: 'preview', label: t('file_preview.markdown.mode.preview'), icon: <Eye size={14} /> }
      ]}
    />
  )
}
