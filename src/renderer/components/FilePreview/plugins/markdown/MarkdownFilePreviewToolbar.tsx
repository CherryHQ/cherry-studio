import { SegmentedControl } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import { FilePreviewToolbar } from '../../FilePreviewToolbar'

export type MarkdownFilePreviewMode = 'preview' | 'source'

interface MarkdownFilePreviewToolbarProps {
  disabled: boolean
  mode: MarkdownFilePreviewMode
  onModeChange: (mode: MarkdownFilePreviewMode) => void
}

export function MarkdownFilePreviewToolbar({ disabled, mode, onModeChange }: MarkdownFilePreviewToolbarProps) {
  const { t } = useTranslation()

  return (
    <FilePreviewToolbar aria-label={t('preview.label')}>
      <SegmentedControl<MarkdownFilePreviewMode>
        size="sm"
        aria-label={t('file_preview.markdown.mode.label')}
        className="rounded-md [&>button]:h-6 [&>button]:rounded-sm [&>button]:px-2"
        disabled={disabled}
        value={mode}
        onValueChange={onModeChange}
        options={[
          { value: 'preview', label: t('file_preview.markdown.mode.preview') },
          { value: 'source', label: t('file_preview.markdown.mode.source') }
        ]}
      />
    </FilePreviewToolbar>
  )
}
