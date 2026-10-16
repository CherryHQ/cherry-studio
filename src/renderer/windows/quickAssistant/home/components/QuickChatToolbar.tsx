import { ExternalLink, EyeOff, Minus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'

interface QuickChatToolbarProps {
  saved: boolean
  loading: boolean
  onNewTemporaryChat: () => void
  onOpenInMainWindow: () => void
  onDelete: () => void
  minimizeDisabled: boolean
  onMinimize: () => void
}

export default function QuickChatToolbar({
  saved,
  loading,
  onNewTemporaryChat,
  onOpenInMainWindow,
  onDelete,
  minimizeDisabled,
  onMinimize
}: QuickChatToolbarProps) {
  const { t } = useTranslation()
  const openLabel = t('quickAssistant.chat.open_in_app')

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border pb-3 [-webkit-app-region:drag]">
      <span
        className="rounded-full border border-border bg-background-subtle px-2.5 py-1 text-xs text-muted-foreground"
        role="status">
        {t(saved ? 'quickAssistant.chat.saved' : 'quickAssistant.chat.temporary')}
      </span>
      <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
        <Tooltip content={t('quickAssistant.chat.new_temporary')}>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={loading}
            aria-label={t('quickAssistant.chat.new_temporary')}
            onClick={onNewTemporaryChat}>
            <EyeOff className="size-4" />
          </Button>
        </Tooltip>
        <Tooltip content={openLabel}>
          <Button variant="ghost" size="icon-sm" disabled={loading} aria-label={openLabel} onClick={onOpenInMainWindow}>
            <ExternalLink className="size-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t('common.minimize')}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.minimize')}
            disabled={minimizeDisabled}
            onClick={onMinimize}>
            <Minus className="size-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t('common.delete')}>
          <Button variant="ghost" size="icon-sm" disabled={loading} aria-label={t('common.delete')} onClick={onDelete}>
            <X className="size-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
