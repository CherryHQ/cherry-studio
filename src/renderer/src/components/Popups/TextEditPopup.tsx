import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Textarea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useLanguages } from '@renderer/hooks/translate/useTranslateLanguages'
import { translateText } from '@renderer/services/TranslateService'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { Languages, Loader2 } from 'lucide-react'
import type { ComponentProps, CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'
import { useTopViewClose } from './useTopViewClose'

const logger = loggerService.withContext('TextEditPopup')

interface PopupButtonProps {
  className?: string
  disabled?: boolean
  style?: CSSProperties
}

interface PopupProps {
  afterClose?: () => void
  cancelButtonProps?: PopupButtonProps
  cancelText?: ReactNode
  className?: string
  closable?: boolean
  keyboard?: boolean
  maskClosable?: boolean
  okButtonProps?: PopupButtonProps
  okText?: ReactNode
  rootClassName?: string
  style?: CSSProperties
  title?: ReactNode
  width?: number | string
}

type TextEditTextareaProps = ComponentProps<typeof Textarea.Input>

interface ShowParams {
  children?: (props: { onOk?: () => void; onCancel?: () => void }) => React.ReactNode
  modalProps?: PopupProps
  showTranslate?: boolean
  text: string
  textareaProps?: TextEditTextareaProps
}

interface Props extends ShowParams {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({
  text,
  textareaProps,
  modalProps,
  resolve,
  children,
  // TODO: should default to false
  showTranslate = true
}) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [textValue, setTextValue] = useState(text)
  const [isTranslating, setIsTranslating] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [targetLanguage] = usePreference('chat.input.translate.target_language')
  const [showTranslateConfirm] = usePreference('chat.input.translate.show_confirm')
  const { languages } = useLanguages()
  const isMounted = useRef(true)
  const {
    className: textareaClassName,
    onChange: handleTextareaChange,
    onInput: handleTextareaInput,
    rows = 2,
    style: textareaStyle,
    ...restTextareaProps
  } = textareaProps ?? {}
  const close = useTopViewClose({ afterClose: modalProps?.afterClose, resolve, setOpen, topViewKey: TopViewKey })

  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  const settle = (result: string | null) => {
    close(result)
  }

  const onOk = () => {
    settle(textValue)
  }

  const onCancel = () => {
    settle(null)
  }

  const resizeTextArea = () => {
    const textArea = textareaRef.current
    const maxHeight = innerHeight * 0.6
    if (textArea) {
      textArea.style.height = 'auto'
      textArea.style.height = textArea?.scrollHeight > maxHeight ? maxHeight + 'px' : `${textArea?.scrollHeight}px`
    }
  }

  useEffect(() => {
    const timer = setTimeout(resizeTextArea, 0)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!open) return

    const timer = window.setTimeout(() => {
      const textArea = textareaRef.current
      if (textArea) {
        textArea.focus()
        const length = textArea.value.length
        textArea.setSelectionRange(length, length)
      }
    }, 200)

    return () => window.clearTimeout(timer)
  }, [open])

  const handleTranslate = async () => {
    if (!textValue.trim() || isTranslating) return

    if (showTranslateConfirm) {
      const confirmed = await window?.modal?.confirm({
        title: t('translate.confirm.title'),
        content: t('translate.confirm.content'),
        centered: true
      })
      if (!confirmed) return
    }

    if (isMounted.current) {
      setIsTranslating(true)
    }

    try {
      const targetVo = languages?.find((l) => l.langCode === targetLanguage)
      const translatedText = await translateText(textValue, targetVo ?? targetLanguage)
      if (isMounted.current) {
        setTextValue(translatedText)
      }
    } catch (error) {
      logger.error('Translation failed:', error as Error)
      window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
    } finally {
      if (isMounted.current) {
        setIsTranslating(false)
      }
    }
  }

  TextEditPopup.hide = onCancel

  const title = modalProps?.title ?? t('common.edit')
  const width = modalProps?.width ?? '60vw'
  const contentStyle: CSSProperties = {
    maxHeight: '70vh',
    ...modalProps?.style,
    width
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        showCloseButton={modalProps?.closable !== false}
        className={cn('max-h-[70vh] overflow-y-auto sm:max-w-none', modalProps?.rootClassName, modalProps?.className)}
        style={contentStyle}
        onEscapeKeyDown={(event) => {
          if (modalProps?.keyboard === false) {
            event.preventDefault()
          }
        }}
        onPointerDownOutside={(event) => {
          if (modalProps?.maskClosable === false) {
            event.preventDefault()
          }
        }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Textarea.Input
            {...restTextareaProps}
            ref={textareaRef}
            rows={rows}
            autoFocus
            spellCheck={false}
            value={textValue}
            onInput={(event) => {
              handleTextareaInput?.(event)
              resizeTextArea()
            }}
            onChange={(event) => {
              handleTextareaChange?.(event)
              setTextValue(event.target.value)
            }}
            style={textareaStyle}
            className={cn(showTranslate && 'pr-10', textareaClassName)}
          />
          {showTranslate && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleTranslate}
              aria-label={t('common.translate_text')}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
              disabled={isTranslating || !textValue.trim()}>
              {isTranslating ? <Loader2 className="size-4 animate-spin" /> : <Languages size={16} />}
            </Button>
          )}
        </div>
        <div className="relative">{children && children({ onOk, onCancel })}</div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={modalProps?.cancelButtonProps?.disabled}
            className={modalProps?.cancelButtonProps?.className}
            style={modalProps?.cancelButtonProps?.style}
            onClick={onCancel}>
            {modalProps?.cancelText ?? t('common.cancel')}
          </Button>
          <Button
            disabled={modalProps?.okButtonProps?.disabled}
            className={modalProps?.okButtonProps?.className}
            style={modalProps?.okButtonProps?.style}
            onClick={onOk}>
            {modalProps?.okText ?? t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'TextEditPopup'

export default class TextEditPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<any>((resolve) => {
      TopView.show(<PopupContainer {...props} resolve={resolve} />, TopViewKey)
    })
  }
}
