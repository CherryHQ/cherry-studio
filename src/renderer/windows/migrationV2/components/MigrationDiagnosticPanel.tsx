import { Button, error as showErrorToast, success as showSuccessToast } from '@cherrystudio/ui'
import { loggerService } from '@renderer/services/LoggerService'
import { Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMigrationActions } from '../hooks/useMigrationProgress'

const SUPPORT_EMAIL = 'support@cherry-ai.com'
const logger = loggerService.withContext('MigrationDiagnosticPanel')

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
  const revealButtonRef = useRef<HTMLButtonElement>(null)
  const saved = diagnosticStatus === 'saved_with_logs' || diagnosticStatus === 'saved_without_logs'

  useEffect(() => {
    if (saved) revealButtonRef.current?.focus()
  }, [saved])

  const handleSave = async () => {
    setDiagnosticStatus('saving')
    try {
      const result = await saveDiagnostics(t('migration.diagnostics.save'), logDate)
      if (result.status === 'canceled') {
        setDiagnosticStatus('idle')
      } else if (result.status === 'failed') {
        setDiagnosticStatus('failed')
        showErrorToast(t('migration.diagnostics.save_failed'))
      } else {
        setDiagnosticStatus(result.logs === 'included' ? 'saved_with_logs' : 'saved_without_logs')
      }
    } catch (error) {
      logger.error('Failed to save migration diagnostic bundle', error as Error)
      setDiagnosticStatus('failed')
      showErrorToast(t('migration.diagnostics.save_failed'))
    }
  }

  const handleReveal = async () => {
    try {
      if (!(await showDiagnosticBundleInFolder())) {
        showErrorToast(t('migration.diagnostics.open_folder_failed'))
      }
    } catch (error) {
      logger.error('Failed to show migration diagnostic bundle in folder', error as Error)
      showErrorToast(t('migration.diagnostics.open_folder_failed'))
    }
  }

  const handleContact = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL)
      showSuccessToast(t('migration.diagnostics.copy_success'))
    } catch {
      showErrorToast(t('migration.diagnostics.copy_failed'))
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-muted/15 px-4 py-3">
      <p className="text-foreground-secondary text-xs leading-relaxed">{t('migration.diagnostics.privacy')}</p>
      <div role="status" aria-live="polite" aria-atomic="true" className="space-y-1 text-xs leading-relaxed">
        {saved && (
          <>
            <p className="font-medium text-foreground">{t('migration.diagnostics.saved_local')}</p>
            {diagnosticStatus === 'saved_without_logs' && (
              <p className="text-foreground-secondary">{t('migration.diagnostics.logs_not_included')}</p>
            )}
          </>
        )}
      </div>
      {saved ? (
        <div className="flex items-center gap-2">
          <Button
            ref={revealButtonRef}
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => void handleReveal()}>
            {t('migration.diagnostics.open_folder')}
          </Button>
          <Button type="button" variant="default" className="flex-1" onClick={() => void handleContact()}>
            {t('migration.diagnostics.contact')}
          </Button>
        </div>
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
  )
}
