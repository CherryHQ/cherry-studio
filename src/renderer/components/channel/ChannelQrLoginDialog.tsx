import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Spinner } from '@cherrystudio/ui'
import { useIpcOn } from '@renderer/ipc'
import type { EventPayload } from '@shared/ipc/types'

type QrLoginStatus = 'starting' | 'pending' | 'confirmed' | 'expired' | 'error'
type QrLoginEvent = EventPayload<'channel.wechat.qr_login'> | EventPayload<'channel.feishu.qr_login'>

/**
 * Runs the adapter's own QR login for a saved, inactive WeChat or Feishu channel: switching it on
 * makes the adapter broadcast the QR code. Closing before the login completes switches it off again.
 */
export function ChannelQrLoginDialog({
  channel,
  onActiveChange,
  onClose
}: {
  channel: { id: string; type: 'wechat' | 'feishu' }
  onActiveChange: (isActive: boolean) => Promise<unknown>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<QrLoginStatus>('starting')
  const [url, setUrl] = useState<string | null>(null)
  const copy =
    channel.type === 'wechat'
      ? { title: 'agent.channels.wechat.qrTitle', hint: 'agent.channels.wechat.qrHint' }
      : { title: 'agent.channels.feishu.qrTitle', hint: 'agent.channels.feishu.qrScanHint' }

  const handleEvent = (data: QrLoginEvent) => {
    if (data.channelId !== channel.id) return
    if (data.status === 'confirmed' || data.status === 'expired' || data.status === 'error') {
      setUrl(null)
      setStatus(data.status)
    } else if (data.status === 'pending' && data.url) {
      setUrl(data.url)
      setStatus('pending')
    }
  }
  useIpcOn('channel.wechat.qr_login', handleEvent)
  useIpcOn('channel.feishu.qr_login', handleEvent)

  const start = () => {
    setStatus('starting')
    void onActiveChange(true).then((result) => result === null && setStatus('error'))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- starts once per opened dialog
  useEffect(start, [channel.id])

  const close = () => {
    if (status !== 'confirmed') void onActiveChange(false)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent closeOnOverlayClick={false} className="max-w-90" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t(copy.title)}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          {url ? (
            <QRCodeSVG value={url} size={240} level="M" marginSize={2} title={t(copy.title)} />
          ) : status === 'starting' ? (
            <div className="flex size-60 items-center justify-center">
              <Spinner text={t('common.loading')} />
            </div>
          ) : null}
          <p role="status" className="text-center text-muted-foreground text-xs">
            {status === 'pending' && t(copy.hint)}
            {status === 'confirmed' &&
              t(channel.type === 'wechat' ? 'agent.channels.wechat.connected' : 'agent.channels.feishu.connected')}
            {status === 'expired' && t('agent.channels.qrSetup.expired')}
            {status === 'error' && t('agent.channels.qrSetup.error')}
          </p>
          {status === 'expired' || status === 'error' ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void onActiveChange(false).then(start)}>
              {t('common.retry')}
            </Button>
          ) : status === 'confirmed' ? (
            <Button type="button" variant="emphasis" size="sm" onClick={onClose}>
              {t('library.config.dialogs.create.channels.done')}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
