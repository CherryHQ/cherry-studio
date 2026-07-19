import { Button } from '@cherrystudio/ui'
import { ClipboardCopy, FolderOpen, Mail } from 'lucide-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

interface MigrationDiagnosticsSavedActionsProps {
  disabled?: boolean
  onOpenEmail: () => void
  onShowInFolder: () => void
  onCopyEmail: () => void
}

export const MigrationDiagnosticsSavedActions: React.FC<MigrationDiagnosticsSavedActionsProps> = ({
  disabled = false,
  onOpenEmail,
  onShowInFolder,
  onCopyEmail
}) => {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-3 gap-2">
      <Button type="button" variant="outline" className="gap-2" disabled={disabled} onClick={onOpenEmail}>
        <Mail size={14} />
        {t('migration.diagnostics.actions.open_email')}
      </Button>
      <Button type="button" variant="outline" className="gap-2" disabled={disabled} onClick={onShowInFolder}>
        <FolderOpen size={14} />
        {t('migration.diagnostics.actions.show_in_folder')}
      </Button>
      <Button type="button" variant="outline" className="gap-2" disabled={disabled} onClick={onCopyEmail}>
        <ClipboardCopy size={14} />
        {t('migration.diagnostics.actions.copy_email')}
      </Button>
    </div>
  )
}
