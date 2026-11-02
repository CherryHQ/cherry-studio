import { Code, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { FilePreviewToolbar } from '@cherrystudio/file-preview/react'
import { Button, Tooltip } from '@cherrystudio/ui'

export type MarkdownFilePreviewMode = 'preview' | 'source'

interface MarkdownFilePreviewToolbarProps {
  disabled: boolean
  mode: MarkdownFilePreviewMode
  onModeChange: (mode: MarkdownFilePreviewMode) => void
}

export function MarkdownFilePreviewToolbar({ disabled, mode, onModeChange }: MarkdownFilePreviewToolbarProps) {
  const { t } = useTranslation()
  const nextMode: MarkdownFilePreviewMode = mode === 'preview' ? 'source' : 'preview'
  const nextLabel = t(
    nextMode === 'source' ? 'file_preview.markdown.mode.source' : 'file_preview.markdown.mode.preview'
  )

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
