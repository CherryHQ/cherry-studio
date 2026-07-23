import { Button } from '@cherrystudio/ui'
import ToastHost from '@renderer/components/ToastHost'
import { toast } from '@renderer/services/toast'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMigrationActions } from '../hooks/useMigrationProgress'

const SUPPORT_EMAIL = 'support@cherry-ai.com'

type DiagnosticStatus = 'idle' | 'saving' | 'saved_with_logs' | 'saved_without_logs' | 'failed'

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function MigrationDiagnosticPanel() {
  const { t } = useTranslation()
  const { saveDiagnostics, showDiagnosticBundleInFolder } = useMigrationActions()
  const [diagnosticStatus, setDiagnosticStatus] = useState<DiagnosticStatus>('idle')
  const [logDate] = useState(() => formatLocalDate(new Date()))
  const saved = diagnosticStatus === 'saved_with_logs' || diagnosticStatus === 'saved_without_logs'

  const handleSave = async () => {
    setDiagnosticStatus('saving')
    try {
      const result = await saveDiagnostics(t('migration.diagnostics.save'), logDate)
      if (result.status === 'canceled') {
        setDiagnosticStatus('idle')
      } else if (result.status === 'failed') {
        setDiagnosticStatus('failed')
        toast.error(t('migration.diagnostics.save_failed'))
      } else {
        setDiagnosticStatus(result.logs === 'included' ? 'saved_with_logs' : 'saved_without_logs')
      }
    } catch {
      setDiagnosticStatus('failed')
      toast.error(t('migration.diagnostics.save_failed'))
    }
  }

  const handleReveal = async () => {
    try {
      if (!(await showDiagnosticBundleInFolder())) {
        toast.error(t('migration.diagnostics.open_folder_failed'))
      }
    } catch {
      toast.error(t('migration.diagnostics.open_folder_failed'))
    }
  }

  const handleContact = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL)
      toast.success(t('migration.diagnostics.copy_success'))
    } catch {
      toast.error(t('migration.diagnostics.copy_failed'))
    }
  }

  return (
    <>
      <section className="space-y-3 rounded-xl border border-border bg-muted/15 px-4 py-3">
        <p className="text-foreground-secondary text-xs leading-relaxed">{t('migration.diagnostics.privacy')}</p>
        {saved ? (
          <>
            <div className="space-y-1 text-xs leading-relaxed">
              <p className="font-medium text-foreground">{t('migration.diagnostics.saved_local')}</p>
              {diagnosticStatus === 'saved_without_logs' && (
                <p className="text-foreground-secondary">{t('migration.diagnostics.logs_not_included')}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => void handleReveal()}>
                {t('migration.diagnostics.open_folder')}
              </Button>
              <Button type="button" variant="default" className="flex-1" onClick={() => void handleContact()}>
                {t('migration.diagnostics.contact')}
              </Button>
            </div>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={diagnosticStatus === 'saving'}
            onClick={() => void handleSave()}>
            <Download className="size-3.5" />
            {t(diagnosticStatus === 'saving' ? 'migration.diagnostics.saving' : 'migration.diagnostics.save')}
          </Button>
        )}
      </section>
      <ToastHost />
    </>
  )
}
