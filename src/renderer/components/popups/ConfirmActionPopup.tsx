import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'
import { AlertCircle } from 'lucide-react'
import type React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConfirmActionParams {
  title?: React.ReactNode
  content?: React.ReactNode
  okText?: React.ReactNode
  cancelText?: React.ReactNode
  /** Render the confirm button as destructive (also the default OK label becomes "Delete"). */
  danger?: boolean
  /** Override the leading icon; pass `null` to hide it. Defaults to a warning glyph. */
  icon?: React.ReactNode
  /**
   * The fallible work to run in-dialog once the user confirms. While it runs the OK
   * button shows a spinner; on success the dialog closes and `show()` resolves `true`.
   * If it rejects, the dialog stays open, re-enables, and surfaces a `toast.error` so
   * the user can retry or cancel — the confirm+run+error-feedback contract the old
   * AppModal `onOk` owned, now in one place instead of scattered across call sites.
   */
  action: () => Promise<void> | void
}

type Props = ConfirmActionParams & PopupInjectedProps<boolean>

const PopupContainer: React.FC<Props> = ({
  open,
  resolve,
  title,
  content,
  okText,
  cancelText,
  danger,
  icon,
  action
}) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)

  const handleCancel = useCallback(() => {
    if (loading) return
    resolve(false)
  }, [loading, resolve])

  const handleConfirm = useCallback(async () => {
    setLoading(true)
    try {
      await action()
    } catch (error) {
      // Pre-regression feedback (was AppModal's onOk catch): toast the failure and keep
      // the dialog open + interactive so the user can retry or cancel.
      toast.error({ title: t('common.error'), description: formatErrorMessage(error) })
      setLoading(false)
      return
    }
    resolve(true)
  }, [action, resolve, t])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        handleCancel()
      }
    },
    [handleCancel]
  )

  const leadingIcon = icon === null ? null : (icon ?? <AlertCircle className="mt-0.5 size-5 shrink-0 text-warning" />)
  const okLabel = okText ?? (danger ? t('common.delete') : t('common.confirm'))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        closeOnOverlayClick={!loading}
        overlayClassName="z-[90]"
        className={cn('confirm-popup z-[90] gap-5 sm:max-w-lg')}
        onInteractOutside={(event) => {
          if (loading) {
            event.preventDefault()
          }
        }}>
        <DialogHeader className="gap-3">
          <div className="flex items-start gap-3">
            {leadingIcon}
            <div className="min-w-0 flex-1">
              {title ? <DialogTitle className="text-base leading-6">{title}</DialogTitle> : null}
              {content ? (
                <DialogDescription asChild>
                  <div
                    className={cn(
                      'wrap-anywhere mt-2 min-w-0 max-w-full text-muted-foreground text-sm leading-5',
                      title ? '' : 'mt-0'
                    )}>
                    {content}
                  </div>
                </DialogDescription>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {cancelText ?? t('common.cancel')}
          </Button>
          <Button variant={danger ? 'destructive' : 'default'} onClick={handleConfirm} loading={loading}>
            {okLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Imperative "confirm, then run an action" dialog. Unlike the `popup.confirm` prefab —
 * which is promise-only and returns the moment the user clicks — this owns the action's
 * in-flight state: it runs `action` behind an OK-button spinner and only closes on
 * success, surfacing failures as a toast while staying open for a retry. Reach for it
 * whenever a confirmation gates a fallible async action; use `popup.confirm` when the
 * confirmation only gates synchronous/local work.
 */
const ConfirmActionPopup = createPopup<ConfirmActionParams, boolean>(PopupContainer, { dismissResult: false })

export default ConfirmActionPopup
