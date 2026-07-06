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
import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import type { ConfirmPopupEntry, ConfirmPopupProps, ConfirmPopupType } from '@renderer/services/popup'
import { popupService } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { formatErrorMessage } from '@renderer/utils/error'
import { AlertCircle, Info, Loader2, TriangleAlert, XCircle } from 'lucide-react'
import type React from 'react'
import { useCallback, useState } from 'react'

const logger = loggerService.withContext('ConfirmPopupItem')

function getIcon(type: ConfirmPopupType, icon: React.ReactNode) {
  if (icon === null) return null
  if (icon !== undefined) return icon

  const className = 'mt-0.5 size-5 shrink-0'

  switch (type) {
    case 'error':
      return <XCircle className={cn(className, 'text-destructive')} />
    case 'warning':
      return <TriangleAlert className={cn(className, 'text-warning')} />
    case 'info':
      return <Info className={cn(className, 'text-info')} />
    case 'confirm':
      return <AlertCircle className={cn(className, 'text-warning')} />
  }
}

function getContentStyle(props: ConfirmPopupProps): React.CSSProperties | undefined {
  const style = { ...props.style }

  if (props.width !== undefined) {
    style.width = props.width
    style.maxWidth = 'calc(100vw - 2rem)'
  }

  return Object.keys(style).length > 0 ? style : undefined
}

function shouldShowOkButton(props: ConfirmPopupProps) {
  return props.okButtonProps?.style?.display !== 'none'
}

function shouldShowCancelButton(type: ConfirmPopupType, props: ConfirmPopupProps) {
  if (props.okCancel === false) return false
  if (type !== 'confirm') return false

  return props.cancelButtonProps?.style?.display !== 'none'
}

function getOkText(type: ConfirmPopupType, props: ConfirmPopupProps) {
  if (props.okText !== undefined) return props.okText

  if (type === 'confirm' && props.okButtonProps?.danger) {
    return i18n.t('common.delete')
  }

  return i18n.t('common.confirm')
}

function getCancelText(props: ConfirmPopupProps) {
  return props.cancelText ?? i18n.t('common.cancel')
}

/**
 * Renders one confirm-family entry from the popup store. Reads `open` from the
 * entry (store-controlled two-phase close) and settles through popupService;
 * `loading` is local UI state so an async onOk can keep the dialog open on failure.
 */
export default function ConfirmPopupItem({ entry }: { entry: ConfirmPopupEntry }) {
  const { props, confirmType: type, instanceId, open } = entry
  const [loading, setLoading] = useState(false)

  const icon = getIcon(type, props.icon)
  const showOkButton = shouldShowOkButton(props)
  const showCancelButton = shouldShowCancelButton(type, props)

  const handleCancel = useCallback(() => {
    void Promise.resolve(props.onCancel?.()).catch((error) => {
      logger.error('confirm onCancel failed', error as Error)
    })
    popupService.settle(instanceId, false)
  }, [instanceId, props])

  const handleConfirm = useCallback(async () => {
    setLoading(true)
    try {
      await props.onOk?.()
      // Reset loading alongside the close so the OK spinner does not linger through
      // the exit animation (parity with the former AppModalItem close).
      setLoading(false)
      popupService.settle(instanceId, true)
    } catch (error) {
      logger.error('confirm onOk failed', error as Error)
      toast.error({ title: i18n.t('common.error'), description: formatErrorMessage(error) })
      setLoading(false)
    }
  }, [instanceId, props])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        handleCancel()
      }
    },
    [handleCancel]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-confirm-popup="true"
        showCloseButton={props.closable === true}
        closeOnOverlayClick={props.maskClosable !== false}
        overlayClassName="z-[90]"
        className={cn('confirm-popup z-[90] gap-5 sm:max-w-lg', props.rootClassName, props.className)}
        style={getContentStyle(props)}
        onInteractOutside={(event) => {
          if (props.maskClosable === false) {
            event.preventDefault()
          }
        }}>
        <DialogHeader className="gap-3">
          <div className="flex items-start gap-3">
            {icon}
            <div className="min-w-0 flex-1">
              {props.title ? <DialogTitle className="text-base leading-6">{props.title}</DialogTitle> : null}
              {props.content ? (
                <DialogDescription asChild>
                  <div
                    className={cn(
                      'wrap-anywhere mt-2 min-w-0 max-w-full text-muted-foreground text-sm leading-5',
                      props.title ? '' : 'mt-0'
                    )}>
                    {props.content}
                  </div>
                </DialogDescription>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        {(showOkButton || showCancelButton) && (
          <DialogFooter>
            {showCancelButton && (
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={props.cancelButtonProps?.disabled || loading}
                className={props.cancelButtonProps?.className}
                style={props.cancelButtonProps?.style}>
                {getCancelText(props)}
              </Button>
            )}
            {showOkButton && (
              <Button
                variant={props.okButtonProps?.danger ? 'destructive' : 'default'}
                onClick={handleConfirm}
                disabled={props.okButtonProps?.disabled}
                loading={loading}
                loadingIcon={<Loader2 className="size-4 animate-spin" />}
                className={props.okButtonProps?.className}
                style={props.okButtonProps?.style}>
                {getOkText(type, props)}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
