import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Spinner } from '@cherrystudio/ui'
import { ipcApi, useIpcOn } from '@renderer/ipc'

type QrLoginStatus = 'starting' | 'pending' | 'confirmed' | 'expired' | 'error'

/**
 * Runs an attempt owned by this dialog. Main deactivates it if the owner cancels before confirmation.
 */
export function ChannelQrLoginDialog({
  channel,
  onClose
}: {
  channel: { id: string; type: 'wechat' | 'feishu' }
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<QrLoginStatus>('starting')
  const [url, setUrl] = useState<string | null>(null)
  const login = useRef<{ requestId?: string; cancelled: boolean; confirmed: boolean } | null>(null)
  const copy =
    channel.type === 'wechat'
      ? { title: 'agent.channels.wechat.qrTitle', hint: 'agent.channels.wechat.qrHint' }
      : { title: 'agent.channels.feishu.qrTitle', hint: 'agent.channels.feishu.qrScanHint' }

  useIpcOn('channel.qr_login.status', (data) => {
    const attempt = login.current
    if (
      !attempt ||
      attempt.cancelled ||
      attempt.confirmed ||
      data.channelId !== channel.id ||
      data.requestId !== attempt.requestId
    )
      return
    if (data.status === 'confirmed' || data.status === 'expired' || data.status === 'error') {
      attempt.confirmed = data.status === 'confirmed'
      setUrl(null)
      setStatus(data.status)
    } else if (data.status === 'pending' && data.url) {
      setUrl(data.url)
      setStatus('pending')
    }
  })

  const start = async (retry: boolean) => {
    const attempt = login.current
    if (!attempt || attempt.cancelled || attempt.confirmed) return
    setStatus('starting')
    setUrl(null)
    try {
      if (retry && attempt.requestId) {
        await ipcApi.request('channel.qr_login.cancel', { channelId: channel.id, requestId: attempt.requestId })
        if (attempt.cancelled) return
      }
      attempt.requestId = crypto.randomUUID()
      const started = await ipcApi.request('channel.qr_login.begin', {
        channelId: channel.id,
        requestId: attempt.requestId
      })
      if (!attempt.cancelled && !attempt.confirmed && !started) setStatus('error')
    } catch {
      if (!attempt.cancelled && !attempt.confirmed) setStatus('error')
    }
  }

  const cancel = () => {
    const attempt = login.current
    if (!attempt || attempt.cancelled) return
    attempt.cancelled = true
    if (!attempt.confirmed && attempt.requestId) {
      void ipcApi
        .request('channel.qr_login.cancel', { channelId: channel.id, requestId: attempt.requestId })
        .catch(() => undefined)
    }
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
