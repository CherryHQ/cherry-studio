import { Check, Copy } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { ErrorDetailAction } from '@renderer/components/ErrorDetailAction'
import { ErrorNotice } from '@renderer/components/ErrorNotice'
import { toast } from '@renderer/services/toast'

/**
 * Persistent first-level notification for a failed install or removal, rendered
 * inside the tool's card — the transient toast it replaces was gone before anyone
 * looked. The full mise output opens in BinaryInstallErrorDialog via onShowError.
 */
export const BinaryInstallFailureRow: FC<{ action?: BinaryOperationError['action']; onShowError: () => void }> = ({
  action = 'install',
  onShowError
}) => {
  const { t } = useTranslation()
  return (
    <ErrorNotice
      variant="inline"
      className="mt-3"
      title={t(action === 'remove' ? 'settings.dependencies.removeError' : 'settings.dependencies.installError')}
      onOpenDetail={onShowError}
    />
  )
}

/** Installs can take minutes (runtime downloads) — say so instead of leaving a bare spinner. */
export const BinaryInstallingHint: FC = () => {
  const { t } = useTranslation()
  return (
    <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{t('settings.dependencies.installingHint')}</p>
  )
}

export interface BinaryOperationError {
  name: string
  message: string
  action: 'install' | 'remove'
}

/**
 * Detail view for a failed binary operation: full mise output, copyable for bug
 * reports. Opened on demand from a card's failed state (Dependencies settings
 * and the Code CLI page) — never auto-popped, the persistent card state is the
 * first-level notification.
 */
export const BinaryInstallErrorDialog: FC<{
  error: BinaryOperationError | null
  onOpenChange: (open: boolean) => void
  /** Surface that hosts the dialog, recorded on the Details snapshot. */
  source: string
}> = ({ error, onOpenChange, source }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copyRequestId = useRef(0)
  const copiedResetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Retain the last error so the dialog keeps its content during the close animation.
  const lastError = useRef<BinaryOperationError>({ name: '', message: '', action: 'install' })
  if (error) lastError.current = error
  const failure = lastError.current
  const summary = `${t(
    failure.action === 'remove' ? 'settings.dependencies.removeError' : 'settings.dependencies.installError'
  )}: ${failure.name}`
  const detailError = useMemo(() => ({ message: failure.message }), [failure.message])

  useEffect(() => {
    copyRequestId.current++
    setCopied(false)
    return () => {
      if (copiedResetTimer.current) clearTimeout(copiedResetTimer.current)
      copiedResetTimer.current = undefined
    }
  }, [error?.action, error?.message, error?.name])

  const copyError = () => {
    const requestId = ++copyRequestId.current
    if (copiedResetTimer.current) clearTimeout(copiedResetTimer.current)
    copiedResetTimer.current = undefined
    navigator.clipboard.writeText(lastError.current.message).then(
      () => {
        if (requestId !== copyRequestId.current) return
        if (copiedResetTimer.current) clearTimeout(copiedResetTimer.current)
        setCopied(true)
        copiedResetTimer.current = setTimeout(() => setCopied(false), 2000)
      },
      // A denied clipboard permission rejects the write — surface it instead of
      // leaving an unhandled rejection and a silently-uncopied error.
      () => {
        if (requestId === copyRequestId.current) toast.error(t('common.copy_failed'))
      }
    )
  }

  return (
    <Dialog open={!!error} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{summary}</DialogTitle>
          <DialogDescription>
            {t(
              lastError.current.action === 'remove'
                ? 'settings.dependencies.removeErrorHint'
                : 'settings.dependencies.installErrorHint'
            )}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap text-muted-foreground select-text">
          {lastError.current.message}
        </pre>
        <DialogFooter>
          <div className="me-auto">
            <ErrorDetailAction
              error={detailError}
              message={summary}
              operation={failure.action === 'remove' ? 'binary.remove' : 'binary.install'}
              recordId={failure.name}
              source={source}
            />
          </div>
          <Button variant="outline" onClick={copyError}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
          <Button variant="emphasis" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
