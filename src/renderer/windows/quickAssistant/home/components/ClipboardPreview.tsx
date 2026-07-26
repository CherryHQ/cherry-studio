import { Copy, X } from 'lucide-react'
import type { FC } from 'react'

interface ClipboardPreviewProps {
  referenceText: string
  clearClipboard: () => void
  t: (key: string) => string
}

const ClipboardPreview: FC<ClipboardPreviewProps> = ({ referenceText, clearClipboard, t }) => {
  if (!referenceText) return null

  return (
    <div className="mb-2.5 rounded-lg bg-muted p-3">
      <div className="flex w-full items-center text-foreground-secondary">
        <Copy className="nodrag size-3.5 shrink-0 cursor-pointer" />
        <p className="nodrag mx-3 min-w-0 flex-1 overflow-hidden text-xs [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
          {referenceText || t('quickAssistant.clipboard.empty')}
        </p>
        <button
          type="button"
          onClick={clearClipboard}
          className="nodrag flex shrink-0 items-center justify-center rounded p-1 text-foreground-secondary transition-colors hover:text-foreground"
          aria-label={t('common.close')}>
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

export default ClipboardPreview
