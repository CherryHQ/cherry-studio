import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/utils'
import { TriangleAlertIcon } from 'lucide-react'
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingIcon } from './Icons'

type PopoverConfirmProps = {
  title: ReactNode
  description?: ReactNode
  onConfirm: (() => Promise<unknown>) | (() => unknown)
  onCancel?: () => void
  classNames?: {
    title?: string
    description?: string
    icon?: string
    confirm?: string
    cancel?: string
  }
  buttonProps?: {
    confirm?: Omit<ComponentProps<typeof Button>, 'className' | 'disabled' | 'onClick'>
    cancel?: Omit<ComponentProps<typeof Button>, 'className' | 'onClick'>
  }
}

const PopoverConfirm = ({
  children,
  title,
  description,
  onConfirm,
  onCancel,
  classNames = {},
  buttonProps = {}
}: PropsWithChildren<PopoverConfirmProps>) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-4 pl-6">
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <TriangleAlertIcon className={cn('size-6 text-warning-base', classNames.icon)} />
            <h3 className={cn('font-bold text-lg', classNames.title)}>{title}</h3>
          </div>
          {description && <p className={cn(classNames.description)}>{description}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false)
              onCancel?.()
            }}
            className={cn(classNames.cancel)}
            {...buttonProps.cancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              setIsLoading(true)
              try {
                await onConfirm()
                setOpen(false)
              } finally {
                setIsLoading(false)
              }
            }}
            disabled={isLoading}
            className={cn(classNames.confirm)}
            {...buttonProps.confirm}>
            {isLoading ? <LoadingIcon /> : t('common.confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default PopoverConfirm
