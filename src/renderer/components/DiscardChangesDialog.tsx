import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@cherrystudio/ui'

export function DiscardChangesDialog({ onCancel, onDiscard }: { onCancel: () => void; onDiscard: () => void }) {
  const { t } = useTranslation()
  return (
    <ConfirmDialog
      open
      destructive
      title={t('common.discard_changes_title')}
      confirmText={t('common.discard_changes')}
      cancelText={t('common.cancel')}
      onOpenChange={(open) => !open && onCancel()}
      onConfirm={onDiscard}
    />
  )
}
