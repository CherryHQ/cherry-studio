import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { CredentialSummary } from '@shared/types/credential'

export function FeishuRegistrationPanel({
  domain,
  purpose,
  applicationCredentialId,
  onRegistered
}: {
  domain: 'feishu' | 'lark'
  purpose: 'channel' | 'knowledge'
  applicationCredentialId?: string
  onRegistered: (application: CredentialSummary, registrationSessionId: string) => Promise<void> | void
}) {
  const { t } = useTranslation()
  const [uri, setUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const callback = useRef(onRegistered)
  callback.current = onRegistered

  useEffect(() => {
    const requestId = crypto.randomUUID()
    let active = true
    setUri(null)
    setFailed(false)
    void (async () => {
      try {
        const begun = await ipcApi.request('feishu.registration.begin', {
          requestId,
          domain,
          purpose,
          applicationCredentialId
        })
        if (!active) return
        setUri(begun.verificationUri)
        const app = await ipcApi.request('feishu.registration.complete', { registrationSessionId: requestId })
        if (!active) return
        await callback.current(app, requestId)
      } catch {
        if (active) setFailed(true)
      }
    })()
    return () => {
      active = false
      void ipcApi.request('feishu.registration.cancel', { registrationSessionId: requestId }).catch(() => {})
    }
  }, [domain, purpose, applicationCredentialId, attempt])

  return (
    <div className="flex flex-col items-center gap-3 py-3">
      {failed ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {t('agent.channels.qrSetup.error')}
          </p>
          <Button type="button" variant="outline" onClick={() => setAttempt(attempt + 1)}>
            {t('common.retry')}
          </Button>
        </>
      ) : uri ? (
        <>
          <QRCodeSVG role="img" value={uri} size={192} level="M" title={t('agent.channels.feishu.qrTitle')} />
          <Button type="button" variant="link" onClick={() => void window.api.shell.openExternal(uri)}>
            {t('chat.artifacts.button.openExternal')}
          </Button>
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
    </div>
  )
}
