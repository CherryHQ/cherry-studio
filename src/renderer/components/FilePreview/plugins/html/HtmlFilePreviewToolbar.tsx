import { Code, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { FilePreviewToolbar } from '@cherrystudio/file-preview/react'
import { Button, Tooltip } from '@cherrystudio/ui'

export type HtmlFilePreviewMode = 'preview' | 'source'

interface HtmlFilePreviewToolbarProps {
  disabled: boolean
  mode: HtmlFilePreviewMode
  onModeChange: (mode: HtmlFilePreviewMode) => void
}

export function HtmlFilePreviewToolbar({ disabled, mode, onModeChange }: HtmlFilePreviewToolbarProps) {
  const { t } = useTranslation()
  const nextMode: HtmlFilePreviewMode = mode === 'preview' ? 'source' : 'preview'
  const nextLabel = t(nextMode === 'source' ? 'file_preview.html.mode.source' : 'file_preview.html.mode.preview')

  return (
    <FilePreviewToolbar aria-label={t('preview.label')}>
      {/* One slot: the button names the mode it switches to. */}
      <Tooltip content={nextLabel} delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={nextLabel}
          disabled={disabled}
          onClick={() => onModeChange(nextMode)}>
          {nextMode === 'source' ? <Code size={14} /> : <Eye size={14} />}
        </Button>
      </Tooltip>
    </FilePreviewToolbar>
  )
}
