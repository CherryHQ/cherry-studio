import { Code2, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { FilePreviewModeTabs } from '../../FilePreviewToolbar'

export type HtmlFilePreviewMode = 'preview' | 'source'

interface HtmlFilePreviewToolbarProps {
  disabled: boolean
  mode: HtmlFilePreviewMode
  onModeChange: (mode: HtmlFilePreviewMode) => void
}

export function HtmlFilePreviewToolbar({ disabled, mode, onModeChange }: HtmlFilePreviewToolbarProps) {
  const { t } = useTranslation()

  return (
    <FilePreviewModeTabs<HtmlFilePreviewMode>
      aria-label={t('file_preview.html.mode.label')}
      disabled={disabled}
      value={mode}
      onValueChange={onModeChange}
      options={[
        { value: 'source', label: t('file_preview.html.mode.source'), icon: <Code2 size={14} /> },
        { value: 'preview', label: t('file_preview.html.mode.preview'), icon: <Eye size={14} /> }
      ]}
    />
  )
}
