import { Check } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  SegmentedControl
} from '@cherrystudio/ui'
import { useInvalidateCache, useQuery } from '@data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type {
  ExternalKnowledgeScopePreview,
  FeishuWikiSpace,
  FeishuWikiSpacePreview
} from '@shared/data/types/externalKnowledgeRead'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'

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

type ScopePreview =
  | { kind: 'url'; data: ExternalKnowledgeScopePreview }
  | { kind: 'space'; data: FeishuWikiSpacePreview }

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
  const [scopeMode, setScopeMode] = useState<'space' | 'url'>('space')
  const [spaces, setSpaces] = useState<FeishuWikiSpace[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | undefined>()
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null)
  const [spacesLoading, setSpacesLoading] = useState(false)
  const [spacesError, setSpacesError] = useState<'permission' | 'other' | null>(null)
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<ScopePreview | null>(null)
  const [name, setName] = useState('')
  const [policy, setPolicy] = useState<'manual' | 'daily'>('manual')
  const [dailyTime, setDailyTime] = useState('09:00')
  const [customApp, setCustomApp] = useState(false)
  const [includeSpaceDiscovery, setIncludeSpaceDiscovery] = useState(false)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [registrationUri, setRegistrationUri] = useState<string | null>(null)
  const [authorization, setAuthorization] = useState<AuthorizationStart | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const registrationSessionId = useRef<string | null>(null)
  const authorizationSessionId = useRef<string | null>(null)
  const closed = useRef(false)
  const spacesRequestVersion = useRef(0)
  const loadedSpacesConnectionId = useRef<string | null>(null)
  const isCreating = busy && step === 3
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const selectConnection = (connectionId: string) => {
    spacesRequestVersion.current += 1
    loadedSpacesConnectionId.current = null
    setSelectedConnectionId(connectionId)
    setSpaces([])
    setNextPageToken(undefined)
    setSelectedSpaceId(null)
    setSpacesLoading(false)
    setSpacesError(null)
    setPreview(null)
    setError(null)
  }

  const loadSpaces = useCallback(async (connectionId: string, pageToken?: string) => {
    const requestVersion = ++spacesRequestVersion.current
    setSpacesLoading(true)
    setSpacesError(null)
    try {
      const page = await ipcApi.request('knowledge.feishu.spaces.list', {
        connectionId,
        ...(pageToken && { pageToken })
      })
      if (closed.current || requestVersion !== spacesRequestVersion.current) return
      if (!pageToken) loadedSpacesConnectionId.current = connectionId
      setSpaces((current) => {
        const knownIds = new Set<string>()
        return [...(pageToken ? current : []), ...page.spaces].filter((space) => {
          if (knownIds.has(space.spaceId)) return false
          knownIds.add(space.spaceId)
          return true
        })
      })
      setNextPageToken(page.nextPageToken)
    } catch (cause) {
      if (closed.current || requestVersion !== spacesRequestVersion.current) return
      setSpacesError(
        cause instanceof IpcError && cause.code === knowledgeErrorCodes.FEISHU_SCOPE_MISSING ? 'permission' : 'other'
      )
    } finally {
      if (!closed.current && requestVersion === spacesRequestVersion.current) setSpacesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (step !== 2 || scopeMode !== 'space' || !selectedConnectionId) return
    if (loadedSpacesConnectionId.current === selectedConnectionId) return
    setSpaces([])
    setNextPageToken(undefined)
    void loadSpaces(selectedConnectionId)
    return () => {
      spacesRequestVersion.current += 1
    }
  }, [step, scopeMode, selectedConnectionId, loadSpaces])

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
    spacesRequestVersion.current += 1
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
    selectConnection(connected.id)
    void invalidate('/external-knowledge-connections')
    return connected.id
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
        appSecret,
        ...(includeSpaceDiscovery && { includeSpaceDiscovery: true })
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

  const reconnect = async (connectionId: string, includeSpaceDiscovery = false) => {
    setBusy(true)
    setError(null)
    try {
      const started = await ipcApi.request('knowledge.feishu.connection.reconnect', {
        connectionId,
        ...(includeSpaceDiscovery && { includeSpaceDiscovery: true })
      })
      const connectedId = await finishAuthorization(started)
      if (
        includeSpaceDiscovery &&
        connectedId &&
        connectedId === selectedConnectionId &&
        step === 2 &&
        scopeMode === 'space'
      ) {
        void loadSpaces(connectedId)
      }
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
    if (!selectedConnectionId || (scopeMode === 'space' ? !selectedSpaceId : !url.trim())) return
    setBusy(true)
    setError(null)
    try {
      if (scopeMode === 'space') {
        const spaceId = selectedSpaceId
        if (!spaceId) return
        const result = await ipcApi.request('knowledge.feishu.space.preview', {
          connectionId: selectedConnectionId,
          spaceId
        })
        if (closed.current) return
        setPreview({ kind: 'space', data: result })
        setName(result.space.name)
      } else {
        const result = await ipcApi.request('knowledge.feishu.scope.preview', {
          connectionId: selectedConnectionId,
          url: url.trim()
        })
        if (closed.current) return
        setPreview({ kind: 'url', data: result })
        setName(result.resolution.selected.title)
      }
      setStep(3)
    } catch (cause) {
      if (!closed.current)
        setError(
          formatErrorMessageWithPrefix(
            cause,
            t(
              scopeMode === 'space'
                ? 'knowledge.external.wizard.preview_space_error'
                : 'knowledge.external.wizard.preview_error'
            )
          )
        )
    } finally {
      if (!closed.current) setBusy(false)
    }
  }

  const createSource = async () => {
    if (busy || !selectedConnectionId || !preview || !name.trim() || (policy === 'daily' && !dailyTime)) return
    setBusy(true)
    setError(null)
    try {
      const source = await ipcApi.request('knowledge.external_source.create', {
        baseId,
        connectionId: selectedConnectionId,
        ...(preview.kind === 'space' ? { spaceId: preview.data.space.spaceId } : { url: url.trim() }),
        name: name.trim()
      })
      if (closed.current) return
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
      void invalidate('/knowledge-bases/:id/external-knowledge-sources')
      close()
    } catch (cause) {
      if (!closed.current) {
        setError(formatErrorMessageWithPrefix(cause, t('knowledge.external.wizard.create_error')))
        setBusy(false)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isCreating && close()}>
      <DialogContent
        closeLabel={t('common.close')}
        closeOnOverlayClick={false}
        showCloseButton={!isCreating}
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('knowledge.external.wizard.title')}</DialogTitle>
        </DialogHeader>
        <div
          className="text-muted-foreground flex shrink-0 flex-wrap gap-3 text-xs"
          aria-label={t('knowledge.external.wizard.title')}>
          <span
            className="aria-[current=step]:font-medium aria-[current=step]:text-foreground"
            aria-current={step === 1 ? 'step' : undefined}>
            {t('knowledge.external.wizard.step_account')}
          </span>
          <span
            className="aria-[current=step]:font-medium aria-[current=step]:text-foreground"
            aria-current={step === 2 ? 'step' : undefined}>
            {t('knowledge.external.wizard.step_scope')}
          </span>
          <span
            className="aria-[current=step]:font-medium aria-[current=step]:text-foreground"
            aria-current={step === 3 ? 'step' : undefined}>
            {t('knowledge.external.wizard.step_preview')}
          </span>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          {step === 1 ? (
            <div className="space-y-4 py-2">
              <p className="text-muted-foreground text-sm">{t('knowledge.external.wizard.choose_connection')}</p>
              {isLoadingConnections ? <p role="status">{t('common.loading')}</p> : null}
              {connectionsError ? (
                <div role="alert" className="text-error-subtle-foreground space-y-2 text-sm">
                  <p>{t('knowledge.external.wizard.connection_error')}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                    {t('knowledge.external.wizard.retry_connections')}
                  </Button>
                </div>
              ) : null}
              {!isLoadingConnections && !connectionsError && connections?.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('knowledge.external.wizard.no_connections')}</p>
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
                      className="aria-pressed:border-selected h-auto w-full justify-start gap-2 py-2 text-left whitespace-normal aria-pressed:bg-accent"
                      onClick={() => selectConnection(connection.id)}>
                      <span className="min-w-0 flex-1 break-words">{label}</span>
                      {selectedConnectionId === connection.id ? <Check className="size-4" aria-hidden="true" /> : null}
                    </Button>
                  ) : connection.authorizationStatus === 'reauthorization-required' ? (
                    <Button
                      key={connection.id}
                      type="button"
                      variant="outline"
                      disabled={busy}
                      className="h-auto w-full justify-start py-2 text-left break-words whitespace-normal"
                      onClick={() => void reconnect(connection.id)}>
                      {t('knowledge.external.wizard.reauthorize', { name: label })}
                    </Button>
                  ) : null
                })}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => void connectPersonalApp()}>
                  {t('knowledge.external.wizard.connect_personal')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-expanded={customApp}
                  aria-controls="feishu-custom-app"
                  onClick={() => setCustomApp(!customApp)}>
                  {t('knowledge.external.wizard.connect_custom')}
                </Button>
              </div>
              {customApp ? (
                <div id="feishu-custom-app" className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="feishu-app-id">{t('knowledge.external.wizard.custom_app_id')}</Label>
                    <Input
                      id="feishu-app-id"
                      disabled={busy}
                      value={appId}
                      onChange={(event) => setAppId(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="feishu-app-secret">{t('knowledge.external.wizard.custom_app_secret')}</Label>
                    <Input
                      id="feishu-app-secret"
                      disabled={busy}
                      type="password"
                      value={appSecret}
                      onChange={(event) => setAppSecret(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="feishu-space-discovery"
                        disabled={busy}
                        checked={includeSpaceDiscovery}
                        onCheckedChange={(checked) => setIncludeSpaceDiscovery(checked === true)}
                      />
                      <Label htmlFor="feishu-space-discovery">{t('knowledge.external.wizard.space_discovery')}</Label>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t('knowledge.external.wizard.space_discovery_help')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    disabled={busy || !appId.trim() || !appSecret}
                    onClick={() => void connectCustomApp()}>
                    {t('knowledge.external.wizard.connect')}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : step === 2 ? (
            <div className="space-y-3 py-2">
              <SegmentedControl<'space' | 'url'>
                aria-label={t('knowledge.external.wizard.scope')}
                value={scopeMode}
                disabled={busy}
                options={[
                  { value: 'space', label: t('knowledge.external.wizard.choose_space') },
                  { value: 'url', label: t('knowledge.external.wizard.paste_link') }
                ]}
                onValueChange={(value) => {
                  setScopeMode(value)
                  setSpacesLoading(false)
                  setPreview(null)
                  setError(null)
                }}
              />
              {scopeMode === 'space' ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-sm">{t('knowledge.external.wizard.available_spaces')}</p>
                  {spacesLoading && spaces.length === 0 ? <p role="status">{t('common.loading')}</p> : null}
                  {spacesError ? (
                    <div role="alert" className="text-error-subtle-foreground space-y-2 text-sm">
                      <p>
                        {t(
                          spacesError === 'permission'
                            ? 'knowledge.external.wizard.spaces_permission_error'
                            : 'knowledge.external.wizard.spaces_error'
                        )}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy || spacesLoading}
                        onClick={() => selectedConnectionId && void loadSpaces(selectedConnectionId, nextPageToken)}>
                        {t('knowledge.external.wizard.retry_spaces')}
                      </Button>
                      {spacesError === 'permission' && selectedConnectionId ? (
                        <div className="space-y-2">
                          <p>{t('knowledge.external.wizard.spaces_reconnect_help')}</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void reconnect(selectedConnectionId, true)}>
                            {t('knowledge.external.wizard.authorize_spaces')}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {!spacesLoading && !spacesError && spaces.length === 0 && !nextPageToken ? (
                    <p className="text-muted-foreground text-sm">{t('knowledge.external.wizard.no_spaces')}</p>
                  ) : null}
                  <div
                    role="group"
                    aria-label={t('knowledge.external.wizard.available_spaces')}
                    className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {spaces.map((space) => (
                      <Button
                        key={space.spaceId}
                        type="button"
                        variant="outline"
                        aria-pressed={selectedSpaceId === space.spaceId}
                        disabled={busy}
                        className="aria-pressed:border-selected h-auto w-full items-start gap-2 py-2 text-left whitespace-normal aria-pressed:bg-accent"
                        onClick={() => {
                          setSelectedSpaceId(space.spaceId)
                          setPreview(null)
                          setError(null)
                        }}>
                        <span className="min-w-0 flex-1 space-y-1 break-words">
                          <span className="block">{space.name}</span>
                          {space.description ? (
                            <span className="text-muted-foreground block text-xs">{space.description}</span>
                          ) : null}
                        </span>
                        {selectedSpaceId === space.spaceId ? <Check className="size-4" aria-hidden="true" /> : null}
                      </Button>
                    ))}
                  </div>
                  {nextPageToken && !spacesError ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || spacesLoading}
                      onClick={() => selectedConnectionId && void loadSpaces(selectedConnectionId, nextPageToken)}>
                      {spacesLoading ? t('common.loading') : t('knowledge.external.wizard.load_more_spaces')}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
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
              )}
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-1 text-sm break-words">
                <p className="font-medium">{t('knowledge.external.wizard.scope')}</p>
                <p>{preview?.kind === 'space' ? preview.data.space.name : preview?.data.resolution.selected.title}</p>
                {preview?.kind === 'url' ? (
                  <>
                    <p className="text-muted-foreground">{preview.data.resolution.account.displayName}</p>
                    <p className="text-muted-foreground">{url}</p>
                  </>
                ) : null}
              </div>
              <div className="text-muted-foreground space-y-1 text-sm">
                <p>{t('knowledge.external.wizard.preview_visible', { count: preview?.data.visibleNodeCount })}</p>
                <p>{t('knowledge.external.wizard.preview_supported', { count: preview?.data.supportedDocxCount })}</p>
                <p>
                  {t('knowledge.external.wizard.preview_unsupported', {
                    count: preview?.data.unsupportedOrSkippedCount
                  })}
                </p>
                <p>{t('knowledge.external.wizard.preview_exact_cost')}</p>
                {preview?.data.warnings.includes('no-supported-documents') ? (
                  <p role="status">{t('knowledge.external.wizard.preview_no_supported')}</p>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="feishu-source-name">{t('knowledge.external.wizard.name')}</Label>
                <Input
                  id="feishu-source-name"
                  disabled={busy}
                  value={name}
                  maxLength={256}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label id="feishu-sync-frequency">{t('knowledge.external.wizard.sync_frequency')}</Label>
                <SegmentedControl<'manual' | 'daily'>
                  aria-labelledby="feishu-sync-frequency"
                  value={policy}
                  disabled={busy}
                  options={[
                    { value: 'manual', label: t('knowledge.external.wizard.manual') },
                    { value: 'daily', label: t('knowledge.external.wizard.daily') }
                  ]}
                  onValueChange={setPolicy}
                />
              </div>
              {policy === 'daily' ? (
                <div className="space-y-1">
                  <Label htmlFor="feishu-daily-time">{t('knowledge.external.wizard.daily_time')}</Label>
                  <Input
                    id="feishu-daily-time"
                    disabled={busy}
                    required
                    aria-invalid={!dailyTime}
                    aria-describedby={!dailyTime ? 'feishu-daily-time-error' : undefined}
                    type="time"
                    value={dailyTime}
                    onChange={(event) => setDailyTime(event.target.value)}
                  />
                  {!dailyTime ? (
                    <p id="feishu-daily-time-error" role="alert" className="text-error-subtle-foreground text-xs">
                      {t('common.required_field')}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground text-xs">
                    {t('knowledge.external.wizard.timezone', { timezone })}
                  </p>
                </div>
              ) : null}
            </div>
          )}

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
          {busy && step === 1 && !registrationUri && !authorization ? (
            <p role="status">{t('knowledge.external.wizard.connecting')}</p>
          ) : null}

          {error ? (
            <p role="alert" className="text-error-subtle-foreground text-sm">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" disabled={isCreating} onClick={close}>
            {t('common.cancel')}
          </Button>
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError(null)
                if (step === 2) setSpacesLoading(false)
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
            <Button
              type="button"
              loading={busy}
              disabled={busy || (scopeMode === 'space' ? spacesLoading || !selectedSpaceId : !url.trim())}
              onClick={() => void previewScope()}>
              {t('common.next')}
            </Button>
          ) : (
            <Button
              type="button"
              loading={busy}
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
