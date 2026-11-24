import {
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Cloud,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  LogIn,
  Terminal
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label
} from '@cherrystudio/ui'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { classifyLocalAgentError } from '@renderer/utils/agent/localAgentError'
import {
  LOCAL_AGENT_PRESETS,
  type LocalAgentAuthMethod,
  type LocalAgentConfiguration,
  type LocalAgentModelCatalog
} from '@shared/ai/localAgent'
import type { OutputFor } from '@shared/ipc/types'

const antigravityMethodIcons: Partial<Record<string, typeof LogIn>> = {
  'oauth-personal': CircleUserRound,
  'oauth-business': Building2,
  'gemini-api-key': KeyRound,
  'agent-platform': Cloud
}

interface CliAuthOption {
  id: string
  nameKey: string
  hintKey: string
  kind: 'browser' | 'api-key'
  recommended?: boolean
}

const CLI_AUTH_OPTIONS: Partial<Record<string, readonly CliAuthOption[]>> = {
  claude: [
    {
      id: 'claude-subscription',
      nameKey: 'local_agents.auth_claude_subscription',
      hintKey: 'local_agents.auth_claude_subscription_hint',
      kind: 'browser',
      recommended: true
    },
    {
      id: 'claude-console',
      nameKey: 'local_agents.auth_claude_console',
      hintKey: 'local_agents.auth_claude_console_hint',
      kind: 'browser'
    }
  ],
  codex: [
    {
      id: 'codex-browser',
      nameKey: 'local_agents.auth_codex_browser',
      hintKey: 'local_agents.auth_codex_browser_hint',
      kind: 'browser',
      recommended: true
    },
    {
      id: 'codex-api-key',
      nameKey: 'local_agents.auth_codex_api_key',
      hintKey: 'local_agents.auth_codex_api_key_hint',
      kind: 'api-key'
    }
  ],
  opencode: [
    {
      id: 'opencode-console',
      nameKey: 'local_agents.auth_opencode_console',
      hintKey: 'local_agents.auth_opencode_console_hint',
      kind: 'browser'
    },
    {
      id: 'opencode-openai',
      nameKey: 'local_agents.auth_opencode_openai',
      hintKey: 'local_agents.auth_opencode_openai_hint',
      kind: 'browser'
    },
    {
      id: 'opencode-copilot',
      nameKey: 'local_agents.auth_opencode_copilot',
      hintKey: 'local_agents.auth_opencode_copilot_hint',
      kind: 'browser'
    }
  ],
  kimi: [
    {
      id: 'kimi-cn',
      nameKey: 'local_agents.auth_kimi_cn',
      hintKey: 'local_agents.auth_kimi_cn_hint',
      kind: 'browser'
    },
    {
      id: 'kimi-global',
      nameKey: 'local_agents.auth_kimi_global',
      hintKey: 'local_agents.auth_kimi_global_hint',
      kind: 'browser'
    }
  ]
}

const PI_QUICK_PROVIDERS = ['openai-codex', 'github-copilot', 'anthropic', 'openai'] as const

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
  const preset = LOCAL_AGENT_PRESETS.find((entry) => entry.id === config.presetId && entry.protocol === config.protocol)
  const usableMethods = methods
    ?.filter((method) => method.type === 'agent' && !preset?.externalCredentialMethods?.includes(method.id))
    .map((method) => ({ ...method, name: methodNames[config.presetId ?? '']?.[method.id] ?? method.name }))
  const cliOptions = !usableMethods?.length ? CLI_AUTH_OPTIONS[config.presetId ?? ''] : undefined
  const hasPiBrowserLogin = !usableMethods?.length && config.presetId === 'pi-acp'
  const hasCliLoginFlow = Boolean(cliOptions?.length || hasPiBrowserLogin)
  const canAuthenticate = Boolean(usableMethods?.length || hasCliLoginFlow)
  const [provider, setProvider] = useState('')
  const [authStatus, setAuthStatus] = useState<{
    signature: string
    status: OutputFor<'ai.local_agents.auth_status'>
  }>()
  const authFailed = !!authenticationError && classifyLocalAgentError(authenticationError).kind === 'authentication'
  const hasNativeStatus = !!preset?.authStatusArgs
  const currentStatus = authStatus?.signature === signature ? authStatus.status : undefined
  const status = authFailed && !hasNativeStatus ? 'signed-out' : (currentStatus ?? 'unknown')
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
      if (!hasNativeStatus || pending) return
      pending = true
      const nextStatus = await ipcApi
        .request('ai.local_agents.auth_status', JSON.parse(signature))
        .catch(() => 'unknown' as const)
      if (active) setAuthStatus({ signature, status: nextStatus })
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
  }, [available, hasNativeStatus, busy, signature, authenticationError, onRefresh])
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
  const [authPrompt, setAuthPrompt] = useState<{ url?: string; code?: string }>()
  const [copiedCode, setCopiedCode] = useState(false)
  const needsKey = method === 'gemini-api-key' || method === 'codex-api-key'
  const platform = method === 'agent-platform'
  const business = method === 'oauth-business'
  const [error, setError] = useState<string>()
  const request = useRef<string | undefined>(undefined)
  const activeFlowKind = useRef<'acp' | 'cli'>('acp')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const generation = useRef(0)

  useIpcOn('ai.local_agents.auth_prompt', (payload) => {
    if (!request.current || payload.requestId !== request.current) return
    setAuthPrompt((prev) => ({
      url: payload.url ?? prev?.url,
      code: payload.code ?? prev?.code
    }))
  })

  const clearCopyState = useCallback(() => {
    if (copyTimer.current) {
      clearTimeout(copyTimer.current)
      copyTimer.current = undefined
    }
    setCopiedCode(false)
  }, [])

  const cancelRequest = useCallback(() => {
    generation.current++
    const requestId = request.current
    request.current = undefined
    setAuthPrompt(undefined)
    clearCopyState()
    if (requestId) void ipcApi.request('ai.local_agents.cancel_auth', { requestId }).catch(() => undefined)
  }, [clearCopyState])

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

  const chooseCliOption = (option: CliAuthOption) => {
    setOpen(true)
    setError(undefined)
    if (option.kind === 'api-key') {
      setMethod(option.id)
      setApiKey('')
      return
    }
    void authenticate(option.id)
  }

  const authenticate = async (methodId: string, overrideProvider?: string) => {
    const nextConfig = { ...config, env: { ...config.env } }
    let secret: string | undefined
    let cliProvider: string | undefined

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
    } else if (methodId === 'codex-api-key') {
      if (!apiKey.trim()) return
      secret = apiKey.trim()
    } else if (methodId === 'pi-browser') {
      const candidate = (overrideProvider ?? provider).trim()
      if (!candidate) return
      cliProvider = candidate
    }

    activeFlowKind.current =
      cliOptions?.some((entry) => entry.id === methodId) || methodId === 'pi-browser' ? 'cli' : 'acp'

    const current = ++generation.current
    const requestId = crypto.randomUUID()
    request.current = requestId
    setAuthPrompt(undefined)
    clearCopyState()
    setBusy(true)
    setError(undefined)
    try {
      await ipcApi.request('ai.local_agents.authenticate', {
        requestId,
        config: nextConfig,
        methodId,
        ...(secret ? { secret } : {}),
        ...(cliProvider ? { provider: cliProvider } : {})
      })
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
        setAuthPrompt(undefined)
        clearCopyState()
        setBusy(false)
      }
    }
  }

  const terminalLogin = async () => {
    cancelRequest()
    const current = ++generation.current
    activeFlowKind.current = 'cli'
    setBusy(true)
    setError(undefined)
    try {
      await onTerminalLogin?.(hasPiBrowserLogin && provider.trim() ? provider.trim() : undefined)
      if (generation.current === current) {
        setMethod(undefined)
        setOpen(false)
      }
    } catch (failure) {
      if (generation.current === current) {
        showError(failure)
        setOpen(true)
      }
    } finally {
      if (generation.current === current) setBusy(false)
    }
  }

  const copyCode = async () => {
    if (!authPrompt?.code) return
    await navigator.clipboard?.writeText(authPrompt.code).catch(() => undefined)
    clearCopyState()
    setCopiedCode(true)
    copyTimer.current = setTimeout(() => {
      setCopiedCode(false)
      copyTimer.current = undefined
    }, 2000)
  }

  if (!available) return null
  if (
    !open &&
    ((hasNativeStatus && authStatus?.signature !== signature) ||
      (sessionRequiresLogin && status === 'unknown' && modelsLoading))
  ) {
    return (
      <Badge variant="outline" role="status" className="h-8 gap-1.5 rounded-lg border-border-subtle px-2.5 text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {t('common.loading')}
      </Badge>
    )
  }
  if (!canAuthenticate && !onTerminalLogin) {
    return signedIn ? (
      <Badge variant="outline" role="status" className="h-8 gap-1.5 rounded-lg border-border-subtle px-2.5 text-xs">
        <CheckCircle2 className="size-3.5 text-muted-foreground" />
        {t('local_agents.signed_in')}
      </Badge>
    ) : null
  }
  const triggerLogin = () => {
    if (!canAuthenticate && onTerminalLogin) void terminalLogin()
    else if (needsLogin && usableMethods?.length === 1) chooseMethod(usableMethods[0].id)
    else {
      setError(undefined)
      setOpen(true)
    }
  }

  const activeCliOption = cliOptions?.find((entry) => entry.id === method)
  const dialogTitle =
    (!method && config.presetId === 'antigravity-acp' ? 'Google Antigravity · ' : '') +
    (usableMethods?.find((entry) => entry.id === method)?.name ??
      (activeCliOption ? t(activeCliOption.nameKey) : undefined) ??
      t(needsLogin ? 'local_agents.sign_in' : 'local_agents.reauthenticate'))

  return (
    <>
      {signedIn ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 rounded-lg border-border-subtle text-xs shadow-none"
              disabled={disabled || busy}>
              <CheckCircle2 className="size-3.5 text-muted-foreground" />
              {t('local_agents.signed_in')}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={disabled || busy} onSelect={triggerLogin}>
              <LogIn className="size-3.5" />
              {t('local_agents.reauthenticate')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="default"
          size="sm"
          className="h-8 shrink-0 gap-1.5 rounded-lg border border-transparent text-xs shadow-none"
          disabled={disabled || busy}
          onClick={triggerLogin}>
          <LogIn className="size-3.5" />
          {t('local_agents.sign_in')}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) cancel()
          setOpen(next)
        }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          {busy ? (
            <div className="space-y-4">
              <p role="status" className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
                <span>
                  {t(
                    activeFlowKind.current === 'cli' ? 'local_agents.auth_waiting_browser' : 'local_agents.auth_waiting'
                  )}
                </span>
              </p>
              {authPrompt?.code && (
                <div className="rounded-lg border border-border-subtle bg-muted/40 p-3">
                  <div className="mb-1.5 text-xs text-muted-foreground">{t('local_agents.auth_device_code_label')}</div>
                  <div className="flex items-center justify-between gap-2">
                    <code className="select-all font-mono text-base font-semibold tracking-widest text-foreground">
                      {authPrompt.code}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1.5 text-xs"
                      onClick={() => void copyCode()}>
                      {copiedCode ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {t(copiedCode ? 'common.copied' : 'local_agents.auth_copy_code')}
                    </Button>
                  </div>
                </div>
              )}
              {authPrompt?.url && (
                <Button asChild variant="outline" className="w-full justify-center gap-2">
                  <a href={authPrompt.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    {t('local_agents.auth_open_browser')}
                  </a>
                </Button>
              )}
            </div>
          ) : hasPiBrowserLogin ? (
            <form
              id="pi-provider-login"
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                void authenticate('pi-browser', provider)
              }}>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('local_agents.auth_pi_hint')}</p>
              <div className="flex flex-wrap gap-1.5">
                {PI_QUICK_PROVIDERS.map((id) => (
                  <Button
                    key={id}
                    type="button"
                    size="sm"
                    variant={provider === id ? 'secondary' : 'outline'}
                    className="h-7 rounded-md px-2.5 text-xs"
                    onClick={() => setProvider(id)}>
                    {id}
                  </Button>
                ))}
              </div>
              <div className="space-y-1.5">
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
                  {PI_QUICK_PROVIDERS.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              </div>
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
          ) : cliOptions?.length ? (
            <div className="flex flex-col gap-2">
              {cliOptions.map((option) => (
                <Button
                  key={option.id}
                  variant="outline"
                  className="h-auto justify-start gap-3 whitespace-normal px-3 py-2.5 text-left"
                  onClick={() => chooseCliOption(option)}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    {option.kind === 'api-key' ? <KeyRound className="size-4" /> : <Globe className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      <span>{t(option.nameKey)}</span>
                      {option.recommended && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                          {t('local_agents.auth_recommended')}
                        </Badge>
                      )}
                    </span>
                    <span className="block text-xs font-normal text-muted-foreground">{t(option.hintKey)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Button>
              ))}
              {config.presetId === 'opencode' && onTerminalLogin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 justify-start gap-2 text-xs text-muted-foreground"
                  onClick={() => void terminalLogin()}>
                  <Terminal className="size-3.5 shrink-0" />
                  <span>{t('local_agents.auth_opencode_terminal')}</span>
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {usableMethods?.map((methodItem) => {
                const Icon =
                  (config.presetId === 'antigravity-acp' &&
                    Object.hasOwn(antigravityMethodIcons, methodItem.id) &&
                    antigravityMethodIcons[methodItem.id]) ||
                  LogIn
                return (
                  <Button
                    key={methodItem.id}
                    variant="outline"
                    className="h-auto min-h-12 justify-start gap-3 whitespace-normal px-3 py-2 text-left"
                    onClick={() => chooseMethod(methodItem.id)}>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon className="size-4" />
                    </span>
                    <span className="flex-1">{methodItem.name}</span>
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
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
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
            {helpUrl && !method && !busy && (
              <Button asChild variant="ghost" size="sm">
                <a href={helpUrl} target="_blank" rel="noreferrer">
                  {t('local_agents.login_help')}
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            )}
            {onTerminalLogin && hasCliLoginFlow && !method && (busy || config.presetId !== 'opencode') && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                disabled={busy && activeFlowKind.current !== 'cli'}
                onClick={() => void terminalLogin()}>
                <Terminal className="size-3.5" />
                {t('local_agents.auth_terminal_fallback')}
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
            {(method || hasPiBrowserLogin) && !busy && (
              <Button
                type="submit"
                form={hasPiBrowserLogin ? 'pi-provider-login' : 'local-agent-auth-form'}
                size="sm"
                disabled={
                  (hasPiBrowserLogin && !provider.trim()) ||
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
