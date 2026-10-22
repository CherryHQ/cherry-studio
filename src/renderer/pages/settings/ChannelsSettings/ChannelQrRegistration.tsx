import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { useChannels } from '@renderer/hooks/agent/useChannels'
import { ipcApi } from '@renderer/ipc'
import type { AgentChannelType } from '@shared/data/api/schemas/agentChannels'

import type { ChannelData } from './channelTypes'

export function ChannelQrRegistration({ channel }: { channel: ChannelData }) {
  const { t } = useTranslation()
  const { mutate } = useChannels(channel.type as AgentChannelType)
  const attempt = useRef<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'pending' | 'confirmed' | 'expired' | 'cancelled' | 'error'>('idle')

  const cancel = () => {
    const requestId = attempt.current
    attempt.current = null
    if (requestId) void ipcApi.request('channel.registration.cancel', { requestId }).catch(() => {})
  }
  useEffect(() => cancel, [channel.id])

  const start = async () => {
    cancel()
    const requestId = crypto.randomUUID()
    attempt.current = requestId
    setStatus('pending')
    try {
      const result = await ipcApi.request('channel.registration.begin', { channelId: channel.id, requestId })
      if (attempt.current !== requestId) return
      setUrl(result.url)
      while (attempt.current === requestId) {
        const polled = await ipcApi.request('channel.registration.poll', { requestId })
        if (attempt.current !== requestId) return
        if (polled.status === 'pending') continue
        setUrl(null)
        setStatus(Date.now() >= result.expiresAt && polled.status !== 'confirmed' ? 'expired' : polled.status)
        cancel()
        if (polled.status === 'confirmed') await mutate()
        return
      }
    } catch {
      if (attempt.current !== requestId) return
      cancel()
      setUrl(null)
      setStatus('error')
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={channel.isActive || status === 'pending'}
        onClick={() => void start()}>
        {t('agent.channels.qrSetup.start')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('agent.channels.qrSetup.hint')}</p>
      <p role="status" className="text-xs text-muted-foreground">
        {status === 'pending' && t('agent.channels.qrSetup.pending')}
        {status === 'confirmed' && t('agent.channels.qrSetup.confirmed')}
        {status === 'expired' && t('agent.channels.qrSetup.expired')}
        {status === 'cancelled' && t('agent.channels.qrSetup.cancelled')}
        {status === 'error' && t('agent.channels.qrSetup.error')}
      </p>
      <Dialog
        open={!!url}
        onOpenChange={(open) => {
          if (!open) {
            cancel()
            setUrl(null)
            setStatus('cancelled')
          }
        }}>
        <DialogContent closeLabel={t('common.close')} className="max-w-90">
          <DialogHeader>
            <DialogTitle>{t('agent.channels.qrSetup.start')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {url && (
              <QRCodeSVG value={url} size={240} level="M" marginSize={4} title={t('agent.channels.qrSetup.start')} />
            )}
            <p className="text-center text-xs text-muted-foreground">{t('agent.channels.qrSetup.pending')}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
