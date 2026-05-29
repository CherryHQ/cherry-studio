import { Box, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Textarea } from '@cherrystudio/ui'
import { X } from 'lucide-react'
import type { ComponentProps, CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView'

type PromptTextAreaProps = Omit<
  ComponentProps<typeof Textarea.Input>,
  'defaultValue' | 'onValueChange' | 'placeholder' | 'ref' | 'value'
> & {
  allowClear?: boolean
  onPressEnter?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  styles?: {
    textarea?: CSSProperties
  }
}

interface PromptPopupShowParams {
  title: string
  message: string
  defaultValue?: string
  inputPlaceholder?: string
  inputProps?: PromptTextAreaProps
  extraNode?: ReactNode
}

interface Props extends PromptPopupShowParams {
  resolve: (value: any) => void
}

const PromptPopupContainer: React.FC<Props> = ({
  title,
  message,
  defaultValue = '',
  inputPlaceholder = '',
  inputProps = {},
  extraNode = null,
  resolve
}) => {
  const [value, setValue] = useState(defaultValue)
  const [open, setOpen] = useState(true)
  const resolvedRef = useRef(false)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const { t } = useTranslation()
  const {
    allowClear = true,
    className,
    onChange,
    onKeyDown,
    onPressEnter,
    rows = 1,
    style,
    styles,
    ...textareaProps
  } = inputProps

  useEffect(() => {
    if (!open) return

    window.setTimeout(() => {
      const textArea = textAreaRef.current
      if (!textArea) return

      textArea.focus()
      const length = textArea.value.length
      textArea.setSelectionRange(length, length)
    })
  }, [open])

  const settle = (result: string | null) => {
    if (resolvedRef.current) return

    resolvedRef.current = true
    resolve(result)
    setOpen(false)
    window.setTimeout(() => TopView.hide(TopViewKey), 200)
  }

  const onOk = () => {
    settle(value)
  }

  const onCancel = () => {
    settle(null)
  }

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onCancel()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event)

    if (event.defaultPrevented) {
      return
    }

    const isEnterPressed = event.key === 'Enter'
    if (isEnterPressed) {
      onPressEnter?.(event)
    }

    if (event.defaultPrevented) {
      return
    }

    if (isEnterPressed && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      onOk()
    }
  }

  PromptPopup.hide = onCancel

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Box className="mb-2">{message}</Box>
        <div className="relative">
          <Textarea.Input
            {...textareaProps}
            ref={textAreaRef}
            placeholder={inputPlaceholder}
            value={value}
            onChange={(event) => {
              onChange?.(event)
              setValue(event.target.value)
            }}
            onKeyDown={handleKeyDown}
            rows={rows}
            style={{ maxHeight: '80vh', ...styles?.textarea, ...style }}
            className={[className, allowClear ? 'pr-10' : undefined].filter(Boolean).join(' ')}
          />
          {allowClear && value && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={textareaProps.disabled || textareaProps.readOnly}
              aria-label={t('common.clear')}
              className="absolute top-2 right-2"
              onClick={() => setValue('')}>
              <X size={14} />
            </Button>
          )}
        </div>
        {extraNode}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onOk}>{t('common.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TopViewKey = 'PromptPopup'

export default class PromptPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: PromptPopupShowParams) {
    return new Promise<string>((resolve) => {
      TopView.show(<PromptPopupContainer {...props} resolve={resolve} />, 'PromptPopup')
    })
  }
}
