import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ScrollArea
} from '@cherrystudio/ui'
import { getChannelTypeIcon } from '@renderer/utils/agentSession'

import { getFormForType } from './ChannelForms'
import { AVAILABLE_CHANNELS, type ChannelData, type ChannelFormProps } from './channelTypes'

type ChannelConfigDialogProps = Omit<ChannelFormProps, 'channel'> & {
  open: boolean
  channel: ChannelData | null
  onClose: () => void
  /** Settings' Agent binding and workspace, between the name and the platform fields. */
  children?: ReactNode
  footer?: ReactNode
  /** Called when a WeChat QR login is abandoned before it completes. */
  onRemove?: () => void
}

/** Per-channel configuration: platform header, name, and the platform's own form. */
export function ChannelConfigDialog({
  open,
  channel,
  onClose,
  children,
  footer,
  onRemove,
  ...formProps
}: ChannelConfigDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  // Keeps the last channel on screen while the dialog animates closed.
  const lastChannelRef = useRef<ChannelData | null>(channel)
  if (channel) lastChannelRef.current = channel
  const renderedChannel = channel ?? (!open ? lastChannelRef.current : null)

  useEffect(() => {
    if (channel) setName(channel.name)
  }, [channel])

  const saveName = () => {
    if (channel && name.trim() && name.trim() !== channel.name) {
      formProps.onConfigChange({ name: name.trim() })
    }
  }

  const platform = AVAILABLE_CHANNELS.find((item) => item.type === renderedChannel?.type)
  const icon = getChannelTypeIcon(renderedChannel?.type)
  const FormComponent = renderedChannel ? getFormForType(renderedChannel.type) : null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        closeOnOverlayClick={false}
        className="flex max-h-[calc(100dvh-2rem)] max-w-125 flex-col gap-4 overflow-hidden"
        closeLabel={t('common.close')}>
        {renderedChannel && (
          <>
            <DialogHeader className="shrink-0 flex-row items-center gap-2.5 space-y-0 text-left">
              {icon && <img src={icon} alt="" className="size-6 shrink-0 rounded object-contain" />}
              <div className="min-w-0">
                <DialogTitle className="text-base">
                  {platform ? t(platform.titleKey) : renderedChannel.name}
                </DialogTitle>
                {platform && <DialogDescription className="text-xs">{t(platform.description)}</DialogDescription>}
              </div>
            </DialogHeader>
            <ScrollArea contentProps={{ className: 'flex flex-col gap-4' }} className="min-h-0">
              <div>
                <Label className="mb-1 block font-normal text-xs">{t('common.name')}</Label>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={saveName}
                  className="h-8 text-sm"
                />
              </div>
              {children}
              {FormComponent && <FormComponent {...formProps} channel={renderedChannel} onRemove={onRemove} />}
            </ScrollArea>
            {footer}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
