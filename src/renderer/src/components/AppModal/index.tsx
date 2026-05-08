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
import i18n from '@renderer/i18n'
import { formatErrorMessage } from '@renderer/utils/error'
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert, XCircle } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

type ModalType = 'confirm' | 'error' | 'info' | 'success' | 'warning'
type ModalAction = () => unknown | Promise<unknown>
type ModalButtonProps = {
  danger?: boolean
  disabled?: boolean
  style?: React.CSSProperties
  className?: string
}

const logger = loggerService.withContext('AppModal')

export interface AppModalFuncProps {
  title?: React.ReactNode
  content?: React.ReactNode
  okText?: React.ReactNode
  cancelText?: React.ReactNode
  onOk?: ModalAction
  onCancel?: ModalAction
  afterClose?: () => void
  okButtonProps?: ModalButtonProps
  cancelButtonProps?: Omit<ModalButtonProps, 'danger'>
  centered?: boolean
  width?: string | number
  icon?: React.ReactNode
  maskClosable?: boolean
  closable?: boolean
  className?: string
  rootClassName?: string
  style?: React.CSSProperties
  okCancel?: boolean
}

export interface AppModalReturn extends PromiseLike<boolean> {
  catch: Promise<boolean>['catch']
  finally: Promise<boolean>['finally']
  destroy: () => void
  update: (config: AppModalFuncProps) => void
}

export interface AppModalApi {
  confirm: (config: AppModalFuncProps) => AppModalReturn
  error: (config: AppModalFuncProps) => AppModalReturn
  info: (config: AppModalFuncProps) => AppModalReturn
  success: (config: AppModalFuncProps) => AppModalReturn
  warning: (config: AppModalFuncProps) => AppModalReturn
  warn: (config: AppModalFuncProps) => AppModalReturn
  destroyAll: () => void
}

interface ModalItem {
  id: string
  type: ModalType
  props: AppModalFuncProps
  open: boolean
  loading: boolean
  resolve: (confirmed: boolean) => void
}

interface Props {
  onReady: (api: AppModalApi) => void
}

const CLOSE_ANIMATION_MS = 200

function createId() {
  return uuidv4()
}

function getIcon(type: ModalType, icon: React.ReactNode) {
  if (icon === null) return null
  if (icon !== undefined) return icon

  const className = 'mt-0.5 size-5 shrink-0'

  switch (type) {
    case 'error':
      return <XCircle className={cn(className, 'text-destructive')} />
    case 'warning':
      return <TriangleAlert className={cn(className, 'text-warning')} />
    case 'success':
      return <CheckCircle2 className={cn(className, 'text-success')} />
    case 'info':
      return <Info className={cn(className, 'text-info')} />
    case 'confirm':
      return <AlertCircle className={cn(className, 'text-warning')} />
  }
}

function getContentStyle(props: AppModalFuncProps): React.CSSProperties | undefined {
  const style = { ...props.style }

  if (props.width !== undefined) {
    style.width = props.width
    style.maxWidth = 'calc(100vw - 2rem)'
  }

  return Object.keys(style).length > 0 ? style : undefined
}

function shouldShowOkButton(props: AppModalFuncProps) {
  return props.okButtonProps?.style?.display !== 'none'
}

function shouldShowCancelButton(type: ModalType, props: AppModalFuncProps) {
  if (props.okCancel === false) return false
  if (type !== 'confirm') return false

  return props.cancelButtonProps?.style?.display !== 'none'
}

function getOkText(type: ModalType, props: AppModalFuncProps) {
  if (props.okText !== undefined) return props.okText

  if (type === 'confirm' && props.okButtonProps?.danger) {
    return i18n.t('common.delete')
  }

  return i18n.t('common.confirm')
}

function getCancelText(props: AppModalFuncProps) {
  return props.cancelText ?? i18n.t('common.cancel')
}

function AppModalItem({
  item,
  close,
  updateLoading
}: {
  item: ModalItem
  close: (id: string, confirmed: boolean, callback?: ModalAction) => void
  updateLoading: (id: string, loading: boolean) => void
}) {
  const { props, type } = item
  const icon = getIcon(type, props.icon)
  const showOkButton = shouldShowOkButton(props)
  const showCancelButton = shouldShowCancelButton(type, props)

  const handleCancel = useCallback(() => {
    close(item.id, false, props.onCancel)
  }, [close, item.id, props.onCancel])

  const handleConfirm = useCallback(async () => {
    updateLoading(item.id, true)
    try {
      await props.onOk?.()
      close(item.id, true)
    } catch (error) {
      logger.error('Modal onOk failed', error as Error)
      window.toast.error({ title: i18n.t('common.error'), description: formatErrorMessage(error) })
      updateLoading(item.id, false)
    }
  }, [close, item.id, props, updateLoading])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleCancel()
      }
    },
    [handleCancel]
  )

  return (
    <Dialog open={item.open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-app-modal="true"
        showCloseButton={props.closable === true}
        className={cn('app-modal gap-5 sm:max-w-lg', props.rootClassName, props.className)}
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
                  <div className={cn('mt-2 text-muted-foreground text-sm leading-5', props.title ? '' : 'mt-0')}>
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
                disabled={props.cancelButtonProps?.disabled || item.loading}
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
                loading={item.loading}
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

export default function AppModalProvider({ onReady }: Props) {
  const [items, setItems] = useState<ModalItem[]>([])
  const itemsRef = useRef<ModalItem[]>([])
  const closeTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const remove = useCallback((id: string) => {
    const item = itemsRef.current.find((current) => current.id === id)
    const closeTimer = closeTimersRef.current.get(id)

    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimersRef.current.delete(id)
    }

    setItems((current) => {
      const nextItems = current.filter((modal) => modal.id !== id)
      itemsRef.current = nextItems
      return nextItems
    })
    item?.props.afterClose?.()
  }, [])

  const scheduleRemove = useCallback(
    (id: string) => {
      const existingTimer = closeTimersRef.current.get(id)

      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      closeTimersRef.current.set(
        id,
        setTimeout(() => {
          remove(id)
        }, CLOSE_ANIMATION_MS)
      )
    },
    [remove]
  )

  const closeItem = useCallback(
    (id: string, confirmed: boolean, callback?: ModalAction) => {
      const item = itemsRef.current.find((current) => current.id === id)
      if (!item || !item.open) return

      void Promise.resolve(callback?.()).catch((error) => {
        logger.error('Modal onCancel failed', error as Error)
      })
      item.resolve(confirmed)

      setItems((current) => {
        const nextItems = current.map((modal) => (modal.id === id ? { ...modal, loading: false, open: false } : modal))
        itemsRef.current = nextItems
        return nextItems
      })
      scheduleRemove(id)
    },
    [scheduleRemove]
  )

  const close = useCallback(
    (id: string, confirmed: boolean, callback?: ModalAction) => {
      closeItem(id, confirmed, callback)
    },
    [closeItem]
  )

  const update = useCallback((id: string, props: AppModalFuncProps) => {
    setItems((current) => {
      const nextItems = current.map((item) => (item.id === id ? { ...item, props: { ...item.props, ...props } } : item))
      itemsRef.current = nextItems
      return nextItems
    })
  }, [])

  const updateLoading = useCallback((id: string, loading: boolean) => {
    setItems((current) => {
      const nextItems = current.map((item) => (item.id === id ? { ...item, loading } : item))
      itemsRef.current = nextItems
      return nextItems
    })
  }, [])

  const show = useCallback(
    (type: ModalType, props: AppModalFuncProps): AppModalReturn => {
      const id = createId()
      let resolvePromise: (confirmed: boolean) => void = () => {}
      const promise = new Promise<boolean>((resolve) => {
        resolvePromise = resolve
      })

      const item: ModalItem = {
        id,
        type,
        props,
        open: true,
        loading: false,
        resolve: resolvePromise
      }

      setItems((current) => {
        const nextItems = current.concat(item)
        itemsRef.current = nextItems
        return nextItems
      })

      return Object.assign(promise, {
        destroy: () => closeItem(id, false),
        update: (config: AppModalFuncProps) => update(id, config)
      })
    },
    [closeItem, update]
  )

  const api = useMemo<AppModalApi>(
    () => ({
      confirm: (config) => show('confirm', config),
      error: (config) => show('error', config),
      info: (config) => show('info', config),
      success: (config) => show('success', config),
      warning: (config) => show('warning', config),
      warn: (config) => show('warning', config),
      destroyAll: () => {
        itemsRef.current.forEach((item) => closeItem(item.id, false))
      }
    }),
    [closeItem, show]
  )

  useEffect(() => {
    onReady(api)
  }, [api, onReady])

  useEffect(() => {
    const closeTimers = closeTimersRef.current

    return () => {
      closeTimers.forEach((timer) => clearTimeout(timer))
      closeTimers.clear()
    }
  }, [])

  return (
    <>
      {items.map((item) => (
        <AppModalItem key={item.id} item={item} close={close} updateLoading={updateLoading} />
      ))}
    </>
  )
}
