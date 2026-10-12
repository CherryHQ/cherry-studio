import { ExternalLink, EyeOff, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'

interface QuickChatToolbarProps {
  saved: boolean
  loading: boolean
  onNewTemporaryChat: () => void
  onOpenInMainWindow: () => void
  onDelete: () => void
  onClose: () => void
}

export default function QuickChatToolbar({
  saved,
  loading,
  onNewTemporaryChat,
  onOpenInMainWindow,
  onDelete,
  onClose
}: QuickChatToolbarProps) {
  const { t } = useTranslation()
  const openLabel = t(saved ? 'quickAssistant.chat.open_in_app' : 'quickAssistant.chat.save_and_open')

  return (
    <div className="flex items-center justify-between gap-2 [-webkit-app-region:no-drag]">
      <span className="text-xs text-muted-foreground" role="status">
        {t(saved ? 'quickAssistant.chat.saved' : 'quickAssistant.chat.temporary')}
      </span>
      <div className="flex items-center gap-1">
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
        <Tooltip content={t('common.delete')}>
          <Button variant="ghost" size="icon-sm" disabled={loading} aria-label={t('common.delete')} onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t('common.close')}>
          <Button variant="ghost" size="icon-sm" disabled={loading} aria-label={t('common.close')} onClick={onClose}>
            <X className="size-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
