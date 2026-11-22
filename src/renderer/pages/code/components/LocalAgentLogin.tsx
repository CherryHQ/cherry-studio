import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Cloud,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { classifyLocalAgentError } from '@renderer/utils/agent/localAgentError'
import type { LocalAgentAuthMethod, LocalAgentConfiguration, LocalAgentModelCatalog } from '@shared/ai/localAgent'
import type { OutputFor } from '@shared/ipc/types'

const antigravityMethodIcons: Partial<Record<string, typeof LogIn>> = {
  'oauth-personal': CircleUserRound,
  'oauth-business': Building2,
  'gemini-api-key': KeyRound,
  'agent-platform': Cloud
}

export function LocalAgentLogin({
  config,
  authMethods,
  modelsLoading,
  freshCatalog,
  authenticationError,
  onRefresh,
  available,
  disabled,
  helpUrl,
  onTerminalLogin,
  onAuthenticated
}: {
  config: LocalAgentConfiguration
  authMethods?: LocalAgentAuthMethod[]
  modelsLoading: boolean
  freshCatalog?: LocalAgentModelCatalog
  authenticationError?: string
  onRefresh?: () => Promise<void>
  available: boolean
  disabled: boolean
  helpUrl?: string
  onTerminalLogin?: (provider?: string) => Promise<void>
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
  const methodNames: Record<string, Record<string, string>> = {
    'antigravity-acp': {
      'oauth-personal': 'Google',
      'oauth-business': 'Gemini Enterprise',
      'gemini-api-key': `Gemini ${t('settings.models.api_key')}`,
      'agent-platform': 'Gemini Enterprise Agent Platform'
    },
    'codebuddy-code': {
      iOA: 'iOA',
      external: 'Google / GitHub',
      internal: t('agent.channels.wechat.title'),
      selfhosted: t('local_agents.auth_enterprise_domain')
    },
    cursor: { cursor_login: `Cursor · ${t('local_agents.sign_in')}` },
    opencode: { 'opencode-login': `OpenCode · ${t('local_agents.sign_in')}` },
    kilo: { 'kilo-login': `Kilo · ${t('local_agents.sign_in')}` },
    hermes: { custom: t('local_agents.auth_runtime_credentials') }
  }
  const usableMethods = methods
    ?.filter((method) => method.type === 'agent')
    .map((method) => ({ ...method, name: methodNames[config.presetId ?? '']?.[method.id] ?? method.name }))
  const canAuthenticate = !!usableMethods?.length
  const needsProvider = !canAuthenticate && config.presetId === 'pi-acp' && !!onTerminalLogin
  const [provider, setProvider] = useState('')
  const [authStatus, setAuthStatus] = useState<{
    signature: string
    status: OutputFor<'ai.local_agents.auth_status'>
  }>()
  const authFailed = !!authenticationError && classifyLocalAgentError(authenticationError).kind === 'authentication'
  const status = authFailed ? 'signed-out' : authStatus?.signature === signature ? authStatus.status : 'unknown'
  const signedIn = status === 'signed-in'
  const needsLogin = !signedIn
  const sessionRequiresLogin =
    config.presetId === 'antigravity-acp' &&
    config.protocol === 'acp' &&
    !config.executableOverride &&
    !config.args.length

  // Antigravity requires credentials for session/new, which produces the live model catalog.
  useEffect(() => {
    if (sessionRequiresLogin && freshCatalog) setAuthStatus({ signature, status: 'signed-in' })
  }, [sessionRequiresLogin, freshCatalog, signature])
  useEffect(() => {
    if (sessionRequiresLogin && authFailed) setAuthStatus({ signature, status: 'signed-out' })
  }, [sessionRequiresLogin, authFailed, signature])

  useEffect(() => {
    if (!available || busy) return
    let active = true
    let pending = false
    const refresh = async () => {
      if (sessionRequiresLogin || !canAuthenticate || pending) return
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
  }, [available, canAuthenticate, busy, signature, authenticationError, onRefresh, sessionRequiresLogin])
  useEffect(() => {
    if (!available || modelsLoading || authMethods !== undefined) return
    let active = true
    void ipcApi
      .request('ai.local_agents.check', JSON.parse(signature))
      .then((result) => {
        if (active && result.protocolInfo) setDiscovered({ signature, methods: result.protocolInfo.authMethods ?? [] })
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
    setProvider('')
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
      if (sessionRequiresLogin) setAuthStatus({ signature, status: 'signed-in' })
      setApiKey('')
      setMethod(undefined)
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
  const terminalLogin = async () => {
    const current = ++generation.current
    setBusy(true)
    setError(undefined)
    try {
      await onTerminalLogin?.(needsProvider ? provider.trim() : undefined)
      if (generation.current === current) setOpen(false)
    } catch (error) {
      if (generation.current === current) {
        showError(error)
        setOpen(true)
      }
    } finally {
      if (generation.current === current) setBusy(false)
    }
  }
  if (!available) return null
  if (sessionRequiresLogin && status === 'unknown' && modelsLoading && !open) {
    return (
      <Badge variant="outline" role="status">
        <Loader2 className="animate-spin" />
        {t('common.loading')}
      </Badge>
    )
  }
  if (!canAuthenticate && !onTerminalLogin) {
    return signedIn ? (
      <Badge variant="outline" role="status">
        <CheckCircle2 />
        {t('local_agents.signed_in')}
      </Badge>
    ) : null
  }
  return (
    <>
      <Button
        variant={needsLogin ? 'default' : 'outline'}
        size="sm"
        className="shrink-0 gap-2"
        disabled={disabled || busy}
        onClick={() => {
          if (!canAuthenticate && onTerminalLogin && !needsProvider) void terminalLogin()
          else if (needsLogin && usableMethods?.length === 1) chooseMethod(usableMethods[0].id)
          else {
            setError(undefined)
            setOpen(true)
          }
        }}>
        {!needsLogin ? <CheckCircle2 className="size-4" /> : <LogIn className="size-4" />}
        {signedIn && (
          <span className="text-muted-foreground">
            {t('local_agents.signed_in')} <span aria-hidden="true">·</span>
          </span>
        )}
        {t(signedIn ? 'local_agents.reauthenticate' : 'local_agents.sign_in')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) cancel()
          setOpen(next)
        }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {!method && config.presetId === 'antigravity-acp' && 'Google Antigravity · '}
              {usableMethods?.find((entry) => entry.id === method)?.name ??
                t(needsLogin ? 'local_agents.sign_in' : 'local_agents.reauthenticate')}
            </DialogTitle>
          </DialogHeader>
          {busy ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('local_agents.auth_waiting')}
            </p>
          ) : needsProvider ? (
            <form
              id="pi-provider-login"
              className="space-y-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                void terminalLogin()
              }}>
              <Label htmlFor="pi-login-provider">{t('error.providerId')}</Label>
              <Input
                id="pi-login-provider"
                list="pi-login-providers"
                placeholder="openai-codex"
                required
                pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]*"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
              />
              <datalist id="pi-login-providers">
                {['openai-codex', 'github-copilot', 'anthropic', 'openai'].map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </form>
          ) : method ? (
            <form
              id="local-agent-auth-form"
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void authenticate(method)
              }}>
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
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="local-agent-login-project">{t('local_agents.auth_project')}</Label>
                        <Input
                          id="local-agent-login-project"
                          value={project}
                          onChange={(event) => setProject(event.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="local-agent-login-location">{t('local_agents.auth_location')}</Label>
                        <Input
                          id="local-agent-login-location"
                          value={location}
                          onChange={(event) => setLocation(event.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
              {business && (
                <p className="text-sm leading-relaxed text-muted-foreground">{t('local_agents.auth_business_hint')}</p>
              )}
            </form>
          ) : (
            <div className="flex flex-col gap-2">
              {usableMethods?.map((method) => {
                const Icon =
                  (config.presetId === 'antigravity-acp' &&
                    Object.hasOwn(antigravityMethodIcons, method.id) &&
                    antigravityMethodIcons[method.id]) ||
                  LogIn
                return (
                  <Button
                    key={method.id}
                    variant="outline"
                    className="h-auto min-h-12 justify-start gap-3 whitespace-normal px-3 py-2 text-left"
                    onClick={() => chooseMethod(method.id)}>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon className="size-4" />
                    </span>
                    <span className="flex-1">{method.name}</span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Button>
                )
              })}
              {!canAuthenticate && onTerminalLogin && (
                <Button variant="outline" onClick={() => void terminalLogin()}>
                  {t('local_agents.sign_in')}
                </Button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2 border-t pt-4">
            {method && !busy && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMethod(undefined)
                  setApiKey('')
                  setError(undefined)
                }}>
                <ArrowLeft className="size-4" />
                {t('common.back')}
              </Button>
            )}
            {helpUrl && !method && (
              <Button asChild variant="ghost" size="sm">
                <a href={helpUrl} target="_blank" rel="noreferrer">
                  {t('local_agents.login_help')}
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            )}
            <Button
              className="ml-auto"
              variant="outline"
              size="sm"
              onClick={() => {
                cancel()
                setOpen(false)
              }}>
              {t('common.cancel')}
            </Button>
            {(method || needsProvider) && !busy && (
              <Button
                type="submit"
                form={needsProvider ? 'pi-provider-login' : 'local-agent-auth-form'}
                size="sm"
                disabled={
                  (needsProvider && !provider.trim()) ||
                  (needsKey && !apiKey.trim()) ||
                  (platform && !apiKey.trim() && (!project.trim() || !location.trim()))
                }>
                {t('local_agents.sign_in')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
