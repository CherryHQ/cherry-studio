import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@cherrystudio/ui'
import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { ExternalKnowledgeScopePreview } from '@shared/data/types/externalKnowledgeRead'

interface FeishuWikiWizardProps {
  open: boolean
  baseId: string
  onOpenChange: (open: boolean) => void
}

type AuthorizationStart = {
  authorizationSessionId: string
  verificationUri: string
  userCode: string
}

const FeishuWikiWizard = ({ open, baseId, onOpenChange }: FeishuWikiWizardProps) => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const {
    data: connections,
    isLoading: isLoadingConnections,
    error: connectionsError,
    refetch
  } = useQuery('/external-knowledge-connections')
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<ExternalKnowledgeScopePreview | null>(null)
  const [name, setName] = useState('')
  const [policy, setPolicy] = useState<'manual' | 'daily'>('manual')
  const [dailyTime, setDailyTime] = useState('09:00')
  const [customApp, setCustomApp] = useState(false)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [registrationUri, setRegistrationUri] = useState<string | null>(null)
  const [authorization, setAuthorization] = useState<AuthorizationStart | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const registrationSessionId = useRef<string | null>(null)
  const authorizationSessionId = useRef<string | null>(null)
  const closed = useRef(false)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const cancelPendingAuthorization = () => {
    if (registrationSessionId.current) {
      void ipcApi.request('knowledge.feishu.registration.cancel', {
        registrationSessionId: registrationSessionId.current
      })
      registrationSessionId.current = null
    }
    if (authorizationSessionId.current) {
      void ipcApi.request('knowledge.feishu.authorization.cancel', {
        authorizationSessionId: authorizationSessionId.current
      })
      authorizationSessionId.current = null
    }
  }

  useEffect(() => {
    return () => {
      closed.current = true
      cancelPendingAuthorization()
    }
  }, [])

  const close = () => {
    closed.current = true
    cancelPendingAuthorization()
    onOpenChange(false)
  }

  const finishAuthorization = async (started: AuthorizationStart) => {
    authorizationSessionId.current = started.authorizationSessionId
    if (closed.current) {
      cancelPendingAuthorization()
      return
    }
    setRegistrationUri(null)
    setAuthorization(started)
    await window.api.shell.openExternal(started.verificationUri)
    if (closed.current) return
    const connected = await ipcApi.request('knowledge.feishu.authorization.complete', {
      authorizationSessionId: started.authorizationSessionId
    })
    authorizationSessionId.current = null
    if (closed.current) return
    setAuthorization(null)
    setSelectedConnectionId(connected.id)
    void invalidate('/external-knowledge-connections')
  }

  const connectPersonalApp = async () => {
    setBusy(true)
    setError(null)
    setCustomApp(false)
    try {
      const registration = await ipcApi.request('knowledge.feishu.registration.begin')
      registrationSessionId.current = registration.registrationSessionId
      if (closed.current) {
        cancelPendingAuthorization()
        return
      }
      setRegistrationUri(registration.verificationUri)
      await window.api.shell.openExternal(registration.verificationUri)
      if (closed.current) return
      const started = await ipcApi.request('knowledge.feishu.authorization.begin', {
        kind: 'personal-agent',
        registrationSessionId: registration.registrationSessionId
      })
      registrationSessionId.current = null
      await finishAuthorization(started)
    } catch (cause) {
      if (!closed.current)
        setError(formatErrorMessageWithPrefix(cause, t('knowledge.external.wizard.authorization_error')))
    } finally {
      if (!closed.current) {
        setBusy(false)
        setRegistrationUri(null)
        setAuthorization(null)
      }
    }
  }

  const connectCustomApp = async () => {
    setBusy(true)
    setError(null)
    try {
      const started = await ipcApi.request('knowledge.feishu.authorization.begin', {
        kind: 'custom-app',
        appId: appId.trim(),
        appSecret
      })
      await finishAuthorization(started)
    } catch (cause) {
      if (!closed.current)
        setError(formatErrorMessageWithPrefix(cause, t('knowledge.external.wizard.authorization_error')))
    } finally {
      if (!closed.current) {
        setBusy(false)
        setAuthorization(null)
      }
    }
  }

  const reconnect = async (connectionId: string) => {
    setBusy(true)
    setError(null)
    try {
      const started = await ipcApi.request('knowledge.feishu.connection.reconnect', { connectionId })
      await finishAuthorization(started)
    } catch (cause) {
      if (!closed.current)
        setError(formatErrorMessageWithPrefix(cause, t('knowledge.external.wizard.authorization_error')))
    } finally {
      if (!closed.current) {
        setBusy(false)
        setAuthorization(null)
      }
    }
  }

  const previewScope = async () => {
    if (!selectedConnectionId || !url.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await ipcApi.request('knowledge.feishu.scope.preview', {
        connectionId: selectedConnectionId,
        url: url.trim()
      })
      if (closed.current) return
      setPreview(result)
      setName(result.resolution.selected.title)
      setStep(3)
    } catch (cause) {
      if (!closed.current) setError(formatErrorMessageWithPrefix(cause, t('knowledge.external.wizard.preview_error')))
    } finally {
      if (!closed.current) setBusy(false)
    }
  }

  const createSource = async () => {
    if (!selectedConnectionId || !preview || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const source = await ipcApi.request('knowledge.external_source.create', {
        baseId,
        connectionId: selectedConnectionId,
        url: url.trim(),
        name: name.trim()
      })
      if (closed.current) return
      close()
      void invalidate('/knowledge-bases/:id/external-knowledge-sources')
      if (policy === 'daily') {
        try {
          await ipcApi.request('knowledge.external_source.schedule.update', {
            sourceId: source.id,
            policy: { kind: 'daily', time: dailyTime, timezone }
          })
        } catch {
          toast.error(t('knowledge.external.wizard.daily_warning'))
        }
      }
    } catch (cause) {
      if (!closed.current) {
        setError(formatErrorMessageWithPrefix(cause, t('knowledge.external.wizard.create_error')))
        setBusy(false)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('knowledge.external.wizard.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-3 text-xs text-muted-foreground" aria-label={t('knowledge.external.wizard.title')}>
          <span aria-current={step === 1 ? 'step' : undefined}>{t('knowledge.external.wizard.step_account')}</span>
          <span aria-current={step === 2 ? 'step' : undefined}>{t('knowledge.external.wizard.step_url')}</span>
          <span aria-current={step === 3 ? 'step' : undefined}>{t('knowledge.external.wizard.step_preview')}</span>
        </div>

        {step === 1 ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">{t('knowledge.external.wizard.choose_connection')}</p>
            {isLoadingConnections ? <p role="status">{t('common.loading')}</p> : null}
            {connectionsError ? (
              <div role="alert" className="space-y-2 text-sm text-error-subtle-foreground">
                <p>{t('knowledge.external.wizard.connection_error')}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                  {t('knowledge.external.wizard.retry_connections')}
                </Button>
              </div>
            ) : null}
            {!isLoadingConnections && !connectionsError && connections?.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('knowledge.external.wizard.no_connections')}</p>
            ) : null}
            {!connectionsError &&
              connections?.map((connection) => {
                const label = connection.displayName || connection.applicationName || connection.appId
                return connection.authorizationStatus === 'connected' ? (
                  <Button
                    key={connection.id}
                    type="button"
                    variant="outline"
                    aria-pressed={selectedConnectionId === connection.id}
                    disabled={busy}
                    className="w-full justify-start"
                    onClick={() => setSelectedConnectionId(connection.id)}>
                    {label}
                  </Button>
                ) : connection.authorizationStatus === 'reauthorization-required' ? (
                  <Button
                    key={connection.id}
                    type="button"
                    variant="outline"
                    disabled={busy}
                    className="w-full justify-start"
                    onClick={() => void reconnect(connection.id)}>
                    {t('knowledge.external.wizard.reauthorize', { name: label })}
                  </Button>
                ) : null
              })}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void connectPersonalApp()}>
                {t('knowledge.external.wizard.connect_personal')}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setCustomApp(true)}>
                {t('knowledge.external.wizard.connect_custom')}
              </Button>
            </div>
            {customApp ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="feishu-app-id">{t('knowledge.external.wizard.custom_app_id')}</Label>
                  <Input id="feishu-app-id" value={appId} onChange={(event) => setAppId(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="feishu-app-secret">{t('knowledge.external.wizard.custom_app_secret')}</Label>
                  <Input
                    id="feishu-app-secret"
                    type="password"
                    value={appSecret}
                    onChange={(event) => setAppSecret(event.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  disabled={busy || !appId.trim() || !appSecret}
                  onClick={() => void connectCustomApp()}>
                  {t('knowledge.external.wizard.connect')}
                </Button>
              </div>
            ) : null}
            {registrationUri ? (
              <div role="status" className="space-y-2 text-sm">
                <p>{t('knowledge.external.wizard.registration_wait')}</p>
                <p>{t('knowledge.external.wizard.registration_help')}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void window.api.shell.openExternal(registrationUri)}>
                  {t('knowledge.external.wizard.open_feishu')}
                </Button>
              </div>
            ) : null}
            {authorization ? (
              <div role="status" className="space-y-2 text-sm">
                <p>{t('knowledge.external.wizard.authorizing')}</p>
                <p>{t('knowledge.external.wizard.verification_code', { code: authorization.userCode })}</p>
                <p>{t('knowledge.external.wizard.authorization_help')}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void window.api.shell.openExternal(authorization.verificationUri)}>
                  {t('knowledge.external.wizard.open_feishu')}
                </Button>
              </div>
            ) : null}
            {busy && !registrationUri && !authorization ? (
              <p role="status">{t('knowledge.external.wizard.connecting')}</p>
            ) : null}
          </div>
        ) : step === 2 ? (
          <div className="space-y-2 py-2">
            <Label htmlFor="feishu-wiki-url">{t('knowledge.external.wizard.url')}</Label>
            <Input
              id="feishu-wiki-url"
              type="url"
              value={url}
              placeholder={t('knowledge.external.wizard.url_placeholder')}
              disabled={busy}
              onChange={(event) => {
                setUrl(event.target.value)
                setPreview(null)
                setError(null)
              }}
            />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1 text-sm">
              <p className="font-medium">{t('knowledge.external.wizard.scope')}</p>
              <p>{preview?.resolution.selected.title}</p>
              <p className="text-muted-foreground">{preview?.resolution.account.displayName}</p>
              <p className="text-muted-foreground">{url}</p>
            </div>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>{t('knowledge.external.wizard.preview_visible', { count: preview?.visibleNodeCount })}</p>
              <p>{t('knowledge.external.wizard.preview_supported', { count: preview?.supportedDocxCount })}</p>
              <p>{t('knowledge.external.wizard.preview_unsupported', { count: preview?.unsupportedOrSkippedCount })}</p>
              <p>{t('knowledge.external.wizard.preview_exact_cost')}</p>
              {preview?.warnings.includes('no-supported-documents') ? (
                <p role="status">{t('knowledge.external.wizard.preview_no_supported')}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="feishu-source-name">{t('knowledge.external.wizard.name')}</Label>
              <Input
                id="feishu-source-name"
                value={name}
                maxLength={256}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                aria-pressed={policy === 'manual'}
                onClick={() => setPolicy('manual')}>
                {t('knowledge.external.wizard.manual')}
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={policy === 'daily'}
                onClick={() => setPolicy('daily')}>
                {t('knowledge.external.wizard.daily')}
              </Button>
            </div>
            {policy === 'daily' ? (
              <div className="space-y-1">
                <Label htmlFor="feishu-daily-time">{t('knowledge.external.wizard.daily_time')}</Label>
                <Input
                  id="feishu-daily-time"
                  type="time"
                  value={dailyTime}
                  onChange={(event) => setDailyTime(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('knowledge.external.wizard.timezone', { timezone })}</p>
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <p role="alert" className="text-sm text-error-subtle-foreground">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            {t('common.cancel')}
          </Button>
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError(null)
                setStep(step === 3 ? 2 : 1)
              }}>
              {t('common.back')}
            </Button>
          ) : null}
          {step === 1 ? (
            <Button type="button" disabled={busy || !selectedConnectionId} onClick={() => setStep(2)}>
              {t('common.next')}
            </Button>
          ) : step === 2 ? (
            <Button type="button" disabled={busy || !url.trim()} onClick={() => void previewScope()}>
              {t('common.next')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy || !name.trim() || (policy === 'daily' && !dailyTime)}
              onClick={() => void createSource()}>
              {t('knowledge.external.wizard.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default FeishuWikiWizard
