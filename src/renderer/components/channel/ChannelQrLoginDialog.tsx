import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
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
  const login = useRef<{ cancelled: boolean; confirmed: boolean } | null>(null)
  const copy =
    channel.type === 'wechat'
      ? { title: 'agent.channels.wechat.qrTitle', hint: 'agent.channels.wechat.qrHint' }
      : { title: 'agent.channels.feishu.qrTitle', hint: 'agent.channels.feishu.qrScanHint' }

  const handleEvent = (data: QrLoginEvent) => {
    const attempt = login.current
    if (!attempt || attempt.cancelled || attempt.confirmed || data.channelId !== channel.id) return
    if (data.status === 'confirmed' || data.status === 'expired' || data.status === 'error') {
      attempt.confirmed = data.status === 'confirmed'
      setUrl(null)
      setStatus(data.status)
    } else if (data.status === 'pending' && data.url) {
      setUrl(data.url)
      setStatus('pending')
    }
  }
  useIpcOn('channel.wechat.qr_login', handleEvent)
  useIpcOn('channel.feishu.qr_login', handleEvent)

  const start = async (retry: boolean) => {
    const attempt = login.current
    if (!attempt || attempt.cancelled || attempt.confirmed) return
    setStatus('starting')
    setUrl(null)
    if (retry) {
      const stopped = await onActiveChange(false)
      if (attempt.cancelled) return
      if (stopped === null) {
        setStatus('error')
        return
      }
    }
    const started = await onActiveChange(true)
    if (!attempt.cancelled && !attempt.confirmed && started === null) setStatus('error')
  }

  const cancel = () => {
    const attempt = login.current
    if (!attempt || attempt.cancelled) return
    attempt.cancelled = true
    if (!attempt.confirmed) void onActiveChange(false)
  }
  const startOnMount = useEffectEvent(() => {
    login.current = { cancelled: false, confirmed: false }
    void start(false)
  })
  const cancelOnUnmount = useEffectEvent(cancel)
  useEffect(() => {
    startOnMount()
    return () => cancelOnUnmount()
  }, [])

  const close = () => {
    cancel()
    onClose()
  }

  const pending = status === 'starting' || status === 'pending'
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent guardDismiss={pending} className="max-w-90" closeLabel={t('common.close')}>
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
            <Button type="button" variant="outline" size="sm" onClick={() => void start(true)}>
              {t('common.retry')}
            </Button>
          ) : status === 'confirmed' ? (
            <Button type="button" variant="emphasis" size="sm" onClick={close}>
              {t('library.config.dialogs.create.channels.done')}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={close}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
