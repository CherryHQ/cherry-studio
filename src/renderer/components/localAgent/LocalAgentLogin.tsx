import { CheckCircle2, Loader2, LogIn } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label, Tooltip } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { classifyLocalAgentError } from '@renderer/utils/agent/localAgentError'
import type { LocalAgentAuthMethod, LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { OutputFor } from '@shared/ipc/types'

export function LocalAgentLogin({
  config,
  authMethods,
  modelsLoading,
  authenticationError,
  sessionReady = false,
  onRefresh,
  available,
  disabled,
  helpUrl,
  onAuthenticated
}: {
  config: LocalAgentConfiguration
  authMethods?: LocalAgentAuthMethod[]
  modelsLoading: boolean
  authenticationError?: string
  sessionReady?: boolean
  onRefresh?: () => Promise<void>
  available: boolean
  disabled: boolean
  helpUrl?: string
  onAuthenticated: (config: LocalAgentConfiguration) => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [discovered, setDiscovered] = useState<{ signature: string; methods: LocalAgentAuthMethod[] }>()
  const signature = JSON.stringify({
    protocol: config.protocol,
    presetId: config.presetId,
    executableOverride: config.executableOverride,
    args: config.args,
    env: config.env,
    enabled: true
  })
  const methods = authMethods ?? (discovered?.signature === signature ? discovered.methods : undefined)
  const usableMethods = methods?.filter((method) => method.type === 'agent' || helpUrl)
  const canAuthenticate = !!usableMethods?.some((method) => method.type === 'agent')
  const [authStatus, setAuthStatus] = useState<{
    signature: string
    status: OutputFor<'ai.local_agents.auth_status'>
  }>()
  const authFailed = !!authenticationError && classifyLocalAgentError(authenticationError).kind === 'authentication'
  const status = authFailed ? 'signed-out' : authStatus?.signature === signature ? authStatus.status : 'unknown'
  const signedIn = status === 'signed-in'
  const ready = !authFailed && status !== 'signed-out' && sessionReady
  const needsLogin = !signedIn && !ready
  useEffect(() => {
    if (!available || busy) return
    let active = true
    let pending = false
    const refresh = async () => {
      if (!canAuthenticate || pending) return
      pending = true
      const status = await ipcApi
        .request('ai.local_agents.auth_status', JSON.parse(signature))
        .catch(() => 'unknown' as const)
      if (active) setAuthStatus({ signature, status })
      pending = false
    }
    void refresh()
    const onFocus = () => {
      void refresh()
      void onRefresh?.().catch(() => undefined)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
    }
  }, [available, canAuthenticate, busy, signature, authenticationError, onRefresh])
  useEffect(() => {
    if (!available || modelsLoading || authMethods !== undefined) return
    let active = true
    void ipcApi
      .request('ai.local_agents.check', JSON.parse(signature))
      .then((result) => {
        if (active && result.protocolInfo) setDiscovered({ signature, methods: result.protocolInfo.authMethods })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [available, modelsLoading, authMethods, signature])
  const [method, setMethod] = useState<string>()
  const [apiKey, setApiKey] = useState('')
  const [project, setProject] = useState('')
  const [location, setLocation] = useState('')
  const needsKey = method === 'gemini-api-key'
  const platform = method === 'agent-platform'
  const business = method === 'oauth-business'
  const [error, setError] = useState<string>()
  const request = useRef<string | undefined>(undefined)
  const generation = useRef(0)
  const cancelRequest = useCallback(() => {
    generation.current++
    const requestId = request.current
    request.current = undefined
    if (requestId) void ipcApi.request('ai.local_agents.cancel_auth', { requestId }).catch(() => undefined)
  }, [])
  const cancel = () => {
    cancelRequest()
    setBusy(false)
    setApiKey('')
    setMethod(undefined)
  }
  useEffect(() => {
    setOpen(false)
    setBusy(false)
    setMethod(undefined)
    setApiKey('')
    setError(undefined)
    return cancelRequest
  }, [cancelRequest, signature])
  const showError = (failure: unknown) => {
    const { kind, message } = classifyLocalAgentError(failure)
    setError(
      kind === 'region'
        ? t('local_agents.auth_region_unavailable')
        : kind === 'timeout'
          ? t('error.request_timeout')
          : message
    )
  }
  const chooseMethod = (methodId: string) => {
    setOpen(true)
    setError(undefined)
    if (
      config.presetId !== 'antigravity-acp' ||
      !['gemini-api-key', 'agent-platform', 'oauth-business'].includes(methodId)
    ) {
      void authenticate(methodId)
      return
    }
    setMethod(methodId)
    setApiKey(config.env[methodId === 'gemini-api-key' ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY'] ?? '')
    setProject(config.env.GOOGLE_CLOUD_PROJECT ?? '')
    setLocation(config.env.GOOGLE_CLOUD_LOCATION ?? '')
  }
  const authenticate = async (methodId: string) => {
    const nextConfig = { ...config, env: { ...config.env } }
    if (config.presetId === 'antigravity-acp') {
      if (methodId === 'gemini-api-key') {
        if (!apiKey.trim()) return
        nextConfig.env.GEMINI_API_KEY = apiKey.trim()
      } else if (methodId === 'agent-platform') {
        nextConfig.env.GOOGLE_API_KEY = apiKey.trim()
        if (!apiKey.trim()) {
          if (!project.trim() || !location.trim()) return
          nextConfig.env.GOOGLE_CLOUD_PROJECT = project.trim()
          nextConfig.env.GOOGLE_CLOUD_LOCATION = location.trim()
        }
      }
    }
    const current = ++generation.current
    const requestId = crypto.randomUUID()
    request.current = requestId
    setBusy(true)
    setError(undefined)
    try {
      await ipcApi.request('ai.local_agents.authenticate', { requestId, config: nextConfig, methodId })
      if (generation.current !== current) return
      request.current = undefined
      await onAuthenticated(nextConfig)
      if (generation.current !== current) return
      setApiKey('')
      setOpen(false)
    } catch (failure) {
      if (generation.current === current) {
        setAuthStatus(undefined)
        showError(failure)
      }
    } finally {
      if (generation.current === current) {
        request.current = undefined
        setBusy(false)
      }
    }
  }
  if (!available || !canAuthenticate || !usableMethods) return null
  return (
    <>
      <Tooltip
        content={t(
          signedIn
            ? 'local_agents.reauthenticate'
            : status === 'signed-out'
              ? 'local_agents.sign_in_required'
              : ready
                ? 'local_agents.session_ready_hint'
                : 'local_agents.auth_status_unknown'
        )}>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 rounded-lg border-border-subtle text-xs shadow-none"
          disabled={disabled || busy}
          onClick={() => {
            if (needsLogin && usableMethods.length === 1) chooseMethod(usableMethods[0].id)
            else {
              setError(undefined)
              setOpen(true)
            }
          }}>
          {!needsLogin ? (
            <CheckCircle2 className="lucide-custom size-3.5 text-muted-foreground" />
          ) : (
            <LogIn className="lucide-custom size-3.5 text-muted-foreground" />
          )}
          {t(signedIn ? 'local_agents.signed_in' : ready ? 'local_agents.session_ready' : 'local_agents.sign_in')}
        </Button>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) cancel()
          setOpen(next)
        }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t(needsLogin ? 'local_agents.sign_in' : 'local_agents.reauthenticate')}</DialogTitle>
          </DialogHeader>
          {busy ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('local_agents.auth_waiting')}
            </p>
          ) : method ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">{usableMethods.find((entry) => entry.id === method)?.name}</p>
              {(needsKey || platform) && (
                <div className="space-y-1.5">
                  <Label htmlFor="local-agent-login-key">{t('settings.models.api_key')}</Label>
                  <Input
                    id="local-agent-login-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </div>
              )}
              {platform && (
                <>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t('local_agents.auth_platform_hint')}
                  </p>
                  {!apiKey.trim() && (
                    <>
                      <Label htmlFor="local-agent-login-project">{t('local_agents.auth_project')}</Label>
                      <Input
                        id="local-agent-login-project"
                        value={project}
                        onChange={(event) => setProject(event.target.value)}
                      />
                      <Label htmlFor="local-agent-login-location">{t('local_agents.auth_location')}</Label>
                      <Input
                        id="local-agent-login-location"
                        value={location}
                        onChange={(event) => setLocation(event.target.value)}
                      />
                    </>
                  )}
                </>
              )}
              {business && (
                <p className="text-sm leading-relaxed text-muted-foreground">{t('local_agents.auth_business_hint')}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setMethod(undefined)
                    setApiKey('')
                    setError(undefined)
                  }}>
                  {t('common.back')}
                </Button>
                <Button
                  disabled={
                    (needsKey && !apiKey.trim()) ||
                    (platform && !apiKey.trim() && (!project.trim() || !location.trim()))
                  }
                  onClick={() => void authenticate(method)}>
                  {t('local_agents.sign_in')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {usableMethods.map((method) =>
                method.type === 'agent' ? (
                  <Button key={method.id} variant="outline" onClick={() => chooseMethod(method.id)}>
                    {method.name}
                  </Button>
                ) : (
                  <Button key={method.id} asChild variant="outline">
                    <a href={helpUrl} target="_blank" rel="noreferrer">
                      {t('local_agents.login_help')}
                    </a>
                  </Button>
                )
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {helpUrl && (
              <Button asChild variant="ghost" size="sm">
                <a href={helpUrl} target="_blank" rel="noreferrer">
                  {t('local_agents.login_help')}
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                cancel()
                setOpen(false)
              }}>
              {t('common.cancel')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
