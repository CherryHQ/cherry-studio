import { SegmentedControl } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import { FilePreviewToolbar } from '../../FilePreviewToolbar'

export type HtmlFilePreviewMode = 'preview' | 'source'

interface HtmlFilePreviewToolbarProps {
  disabled: boolean
  mode: HtmlFilePreviewMode
  onModeChange: (mode: HtmlFilePreviewMode) => void
}

export function HtmlFilePreviewToolbar({ disabled, mode, onModeChange }: HtmlFilePreviewToolbarProps) {
  const { t } = useTranslation()

  return (
    <FilePreviewToolbar aria-label={t('preview.label')}>
      <SegmentedControl<HtmlFilePreviewMode>
        size="sm"
        aria-label={t('file_preview.html.mode.label')}
        className="rounded-md [&>button]:h-6 [&>button]:rounded-sm [&>button]:px-2"
        disabled={disabled}
        value={mode}
        onValueChange={onModeChange}
        options={[
          { value: 'preview', label: t('file_preview.html.mode.preview') },
          { value: 'source', label: t('file_preview.html.mode.source') }
        ]}
      />
    </FilePreviewToolbar>
  )
}
