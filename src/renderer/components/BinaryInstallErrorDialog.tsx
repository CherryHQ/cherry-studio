import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'
import { Check, Copy, TriangleAlert } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Persistent first-level notification for a failed install, rendered inside
 * the tool's card — the transient toast it replaces was gone before anyone
 * looked. Shows the first line of the mise error; the full output opens in
 * BinaryInstallErrorDialog via onShowError.
 */
export const BinaryInstallFailureRow: FC<{ error: string; onShowError: () => void }> = ({ error, onShowError }) => {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onShowError}
      title={error}
      className="mt-3 flex w-full min-w-0 items-center gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-left text-[11px] text-destructive transition-colors hover:bg-destructive/15">
      <TriangleAlert className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{error.split(/\r?\n/)[0]}</span>
      <span className="shrink-0 underline underline-offset-2">{t('settings.dependencies.viewErrorDetails')}</span>
    </button>
  )
}

/** Installs can take minutes (runtime downloads) — say so instead of leaving a bare spinner. */
export const BinaryInstallingHint: FC = () => {
  const { t } = useTranslation()
  return (
    <p className="mt-1.5 text-[11px] text-muted-foreground leading-4">{t('settings.dependencies.installingHint')}</p>
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
}> = ({ error, onOpenChange }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copyRequestId = useRef(0)
  const copiedResetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Retain the last error so the dialog keeps its content during the close animation.
  const lastError = useRef<BinaryOperationError>({ name: '', message: '', action: 'install' })
  if (error) lastError.current = error

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
          <DialogTitle>{`${t(
            lastError.current.action === 'remove'
              ? 'settings.dependencies.removeError'
              : 'settings.dependencies.installError'
          )}: ${lastError.current.name}`}</DialogTitle>
          <DialogDescription>
            {t(
              lastError.current.action === 'remove'
                ? 'settings.dependencies.removeErrorHint'
                : 'settings.dependencies.installErrorHint'
            )}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-72 select-text overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-muted-foreground text-xs leading-5">
          {lastError.current.message}
        </pre>
        <DialogFooter>
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
