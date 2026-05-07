import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { TopView } from '@renderer/components/TopView'
import type { CSSProperties, ReactNode } from 'react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const CLOSE_ANIMATION_MS = 200

interface PopupButtonProps {
  className?: string
  danger?: boolean
  disabled?: boolean
  style?: CSSProperties
}

interface PopupStyles {
  body?: CSSProperties
  content?: CSSProperties
  header?: CSSProperties
}

interface ShowParams {
  cancelButtonProps?: PopupButtonProps
  cancelText?: ReactNode
  className?: string
  closable?: boolean
  content: ReactNode
  footer?: ReactNode | null
  keyboard?: boolean
  maskClosable?: boolean
  okButtonProps?: PopupButtonProps
  okText?: ReactNode
  onCancel?: () => void
  onOk?: () => unknown
  rootClassName?: string
  style?: CSSProperties
  styles?: PopupStyles
  title?: ReactNode
  width?: number | string
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const getContentStyle = ({
  style,
  styles,
  width
}: Pick<ShowParams, 'style' | 'styles' | 'width'>): CSSProperties | undefined => {
  const contentStyle: CSSProperties = {
    ...styles?.content,
    ...style
  }

  if (width !== undefined) {
    contentStyle.width = width
  }

  return Object.keys(contentStyle).length > 0 ? contentStyle : undefined
}

const PopupContainer: React.FC<Props> = ({
  cancelButtonProps,
  cancelText,
  className,
  closable = true,
  content,
  footer,
  keyboard = true,
  maskClosable = true,
  okButtonProps,
  okText,
  onCancel: handleCancel,
  onOk: handleOk,
  resolve,
  rootClassName,
  styles,
  title,
  width,
  ...rest
}) => {
  const [open, setOpen] = useState(true)
  const resolvedRef = useRef(false)
  const { t } = useTranslation()

  const settle = (result: any) => {
    if (resolvedRef.current) return

    resolvedRef.current = true
    setOpen(false)
    window.setTimeout(() => {
      resolve(result)
    }, CLOSE_ANIMATION_MS)
  }

  const onOk = async () => {
    if (resolvedRef.current) return

    await handleOk?.()
    settle({})
  }

  const onCancel = () => {
    if (resolvedRef.current) return

    handleCancel?.()
    settle({})
  }

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onCancel()
    }
  }

  GeneralPopup.hide = onCancel

  const shouldUseCustomWidth =
    width !== undefined || rest.style?.maxWidth !== undefined || styles?.content?.maxWidth !== undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={closable}
        className={cn(shouldUseCustomWidth && 'sm:max-w-none', rootClassName, className)}
        style={getContentStyle({ ...rest, styles, width })}
        onEscapeKeyDown={(event) => {
          if (!keyboard) {
            event.preventDefault()
          }
        }}
        onPointerDownOutside={(event) => {
          if (!maskClosable) {
            event.preventDefault()
          }
        }}>
        <DialogHeader className={title ? undefined : 'sr-only'} style={styles?.header}>
          <DialogTitle>{title ?? 'Dialog'}</DialogTitle>
        </DialogHeader>
        <div style={styles?.body}>{content}</div>
        {footer !== null &&
          (footer !== undefined ? (
            <DialogFooter>{footer}</DialogFooter>
          ) : (
            <DialogFooter>
              <Button
                variant="outline"
                disabled={cancelButtonProps?.disabled}
                className={cancelButtonProps?.className}
                style={cancelButtonProps?.style}
                onClick={onCancel}>
                {cancelText ?? t('common.cancel')}
              </Button>
              <Button
                variant={okButtonProps?.danger ? 'destructive' : 'default'}
                disabled={okButtonProps?.disabled}
                className={okButtonProps?.className}
                style={okButtonProps?.style}
                onClick={onOk}>
                {okText ?? t('common.confirm')}
              </Button>
            </DialogFooter>
          ))}
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'GeneralPopup'

/** 在这个 Popup 中展示任意内容 */
export default class GeneralPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
