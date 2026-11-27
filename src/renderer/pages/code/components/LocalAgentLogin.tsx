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

import type { CliAuthOption } from '@cherrystudio/agent-runtime/cli'
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
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
  Label,
  Tooltip
} from '@cherrystudio/ui'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { classifyLocalAgentError } from '@renderer/utils/agent/localAgentError'
import {
  getLocalAgentPreset,
  type LocalAgentAccount,
  type LocalAgentAuthMethod,
  type LocalAgentConfiguration,
  type LocalAgentModelCatalog
} from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { OutputFor } from '@shared/ipc/types'

const loginIcons = { browser: CircleUserRound, enterprise: Building2, 'api-key': KeyRound, cloud: Cloud }

type AccountResult = OutputFor<'ai.local_agents.read_account'>
const cachedAccounts = new Map<string, AccountResult>()

export function clearLocalAgentAuthStatusCache(): void {
  cachedAccounts.clear()
}

function accountSignature(config: LocalAgentConfiguration, agent?: Pick<AgentEntity, 'id' | 'localRuntime'>) {
  return JSON.stringify([
    agent?.localRuntime?.providerId,
    {
      agentId: agent?.id,
      presetId: config.presetId,
      executableOverride: config.executableOverride,
      args: config.args,
      env: config.env,
      enabled: true
    }
  ])
}

export function LocalAgentLogin({
  config,
  agent,
  authMethods,
  modelsLoading,
  freshCatalog,
  authenticationError,
  onRefresh,
  available,
  disabled,
  helpUrl,
  onTerminalLogin,
  onConfigureCredentials,
  onAuthenticated
}: {
  config: LocalAgentConfiguration
  agent?: Pick<AgentEntity, 'id' | 'localRuntime'>
  authMethods?: LocalAgentAuthMethod[]
  modelsLoading: boolean
  freshCatalog?: LocalAgentModelCatalog
  authenticationError?: string
  onRefresh?: () => Promise<void>
  available: boolean
  disabled: boolean
  helpUrl?: string
  onTerminalLogin?: (provider?: string) => Promise<void>
  onConfigureCredentials?: () => void
  onAuthenticated: (config: LocalAgentConfiguration, account?: LocalAgentAccount) => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [discovered, setDiscovered] = useState<{ signature: string; methods: LocalAgentAuthMethod[] }>()
  const signature = accountSignature(config, agent)
  const preset = getLocalAgentPreset(config.presetId)
  const account = preset?.account
  const methods: readonly LocalAgentAuthMethod[] | undefined =
    account?.methods ?? authMethods ?? (discovered?.signature === signature ? discovered.methods : undefined)
  const methodNames: Record<string, Record<string, string>> = {
    'codebuddy-code': {
      iOA: 'iOA',
      external: 'Google / GitHub',
      internal: t('agent.channels.wechat.title'),
      selfhosted: t('local_agents.auth_enterprise_domain')
    },
    opencode: { 'opencode-login': `OpenCode · ${t('local_agents.sign_in')}` },
    kilo: { 'kilo-login': `Kilo · ${t('local_agents.sign_in')}` },
    hermes: { custom: t('local_agents.auth_runtime_credentials') }
  }
  const loginMethod = (id: string | undefined) =>
    account?.methods?.find((method) => method.id === id) ?? preset?.auth?.methods.find((method) => method.id === id)
  const usableMethods = methods
    ?.filter((method) => method.type === 'agent' && !preset?.externalCredentialMethods?.includes(method.id))
    .map((method) => {
      const declared = loginMethod(method.id)
      const name =
        declared?.form === 'api-key'
          ? `${declared.name} ${t('settings.models.api_key')}`
          : declared && 'clearEnv' in declared
            ? `${declared.name} · ${t('local_agents.sign_in')}`
            : declared?.name
      return { ...method, name: name ?? methodNames[config.presetId ?? '']?.[method.id] ?? method.name }
    })
  const cliOptions = preset?.cliLogin
  const providerLogin = !usableMethods?.length ? preset?.providerLogin : undefined
  const hasCliLoginFlow = Boolean(cliOptions?.length || providerLogin)
  const canAuthenticate = Boolean(usableMethods?.length || hasCliLoginFlow)
  const [provider, setProvider] = useState('')
  const [accountRead, setAccountRead] = useState<{
    signature: string
    result: AccountResult
  }>()
  const authFailed = !!authenticationError && classifyLocalAgentError(authenticationError).kind === 'authentication'
  const canReadAccount = account?.canReadAccount || !!preset?.accountProbe
  const currentAccount = accountRead?.signature === signature ? accountRead.result : cachedAccounts.get(signature)
  const status = authFailed && !canReadAccount ? 'signed-out' : (currentAccount?.status ?? 'unknown')
  const signedIn = status === 'signed-in'
  const identity = signedIn && currentAccount?.status === 'signed-in' ? currentAccount.account : undefined
  const accountLabel = identity?.email || identity?.displayName || identity?.id
  const needsLogin = !signedIn
  const sessionRequiresLogin = preset?.auth?.catalogRequiresLogin && !config.executableOverride && !config.args.length

  useEffect(() => {
    if (!canReadAccount && sessionRequiresLogin && freshCatalog) {
      const result = { status: 'signed-in' } as const
      cachedAccounts.set(signature, result)
      setAccountRead({ signature, result })
    }
  }, [canReadAccount, sessionRequiresLogin, freshCatalog, signature])
  useEffect(() => {
    if (!canReadAccount && sessionRequiresLogin && authFailed) {
      const result = { status: 'signed-out' } as const
      cachedAccounts.set(signature, result)
      setAccountRead({ signature, result })
    }
  }, [canReadAccount, sessionRequiresLogin, authFailed, signature])

  useEffect(() => {
    if (!available || busy) return
    let active = true
    let pending = false
    let refreshRequested = false
    const refresh = async () => {
      if (!canReadAccount) return
      if (pending) {
        refreshRequested = true
        return
      }
      pending = true
      const result = await ipcApi
        .request('ai.local_agents.read_account', JSON.parse(signature)[1])
        .catch(() => ({ status: 'unknown' as const }))
      pending = false
      if (!active) return
      if (refreshRequested) {
        refreshRequested = false
        void refresh()
        return
      }
      if (result.status === 'signed-in' || result.status === 'signed-out') cachedAccounts.set(signature, result)
      else cachedAccounts.delete(signature)
      setAccountRead({ signature, result })
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
  }, [available, canReadAccount, busy, signature, authenticationError, onRefresh])
  useEffect(() => {
    if (!available || modelsLoading || authMethods !== undefined) return
    let active = true
    void ipcApi
      .request('ai.local_agents.check', JSON.parse(signature)[1])
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
  const [authConsent, setAuthConsent] = useState<{ id: string; url: string; message: string }>()
  const [copiedCode, setCopiedCode] = useState(false)
  const form = loginMethod(method)?.form
  const needsKey = form === 'api-key' || cliOptions?.find((option) => option.id === method)?.kind === 'api-key'
  const platform = form === 'cloud'
  const business = form === 'enterprise'
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

  useIpcOn('ai.local_agents.auth_consent', ({ requestId, promptId, prompt }) => {
    if (requestId !== request.current) return
    if (prompt) setAuthConsent({ id: promptId, ...prompt })
    else setAuthConsent((current) => (current?.id === promptId ? undefined : current))
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
    setAuthConsent(undefined)
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

  const respondToBrowserConsent = (decision: 'accept' | 'decline') => {
    const requestId = request.current
    if (!requestId || !authConsent) return
    void ipcApi
      .request('ai.local_agents.respond_auth_consent', { requestId, promptId: authConsent.id, decision })
      .catch((failure) => {
        if (request.current === requestId) showError(failure)
      })
  }

  const chooseMethod = (methodId: string) => {
    setOpen(true)
    setError(undefined)
    const native = loginMethod(methodId)
    if (!native || native.form === 'browser') {
      void authenticate(methodId)
      return
    }
    setMethod(methodId)
    setApiKey('apiKey' in native ? (config.env[native.apiKey] ?? '') : '')
    setProject(native.form === 'cloud' ? (config.env[native.project] ?? '') : '')
    setLocation(native.form === 'cloud' ? (config.env[native.location] ?? '') : '')
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

    const native = loginMethod(methodId)
    const method = account?.methods?.find((entry) => entry.id === methodId)
    if (method?.form === 'browser') {
      for (const key of method.clearEnv ?? []) delete nextConfig.env[key]
    } else if (native?.form === 'api-key') {
      if (!apiKey.trim()) return
      nextConfig.env[native.apiKey] = apiKey.trim()
    } else if (native?.form === 'cloud') {
      nextConfig.env[native.apiKey] = apiKey.trim()
      if (!apiKey.trim()) {
        if (!project.trim() || !location.trim()) return
        nextConfig.env[native.project] = project.trim()
        nextConfig.env[native.location] = location.trim()
      }
    } else if (cliOptions?.find((option) => option.id === methodId)?.kind === 'api-key') {
      if (!apiKey.trim()) return
      secret = apiKey.trim()
    } else if (methodId === providerLogin?.id) {
      const candidate = (overrideProvider ?? provider).trim()
      if (!candidate) return
      cliProvider = candidate
    }

    activeFlowKind.current =
      cliOptions?.some((entry) => entry.id === methodId) || methodId === providerLogin?.id ? 'cli' : 'acp'

    const current = ++generation.current
    const requestId = crypto.randomUUID()
    request.current = requestId
    setAuthPrompt(undefined)
    setAuthConsent(undefined)
    clearCopyState()
    setBusy(true)
    setError(undefined)
    try {
      const account = await ipcApi.request('ai.local_agents.authenticate', {
        requestId,
        config: nextConfig,
        methodId,
        ...(agent && { agentId: agent.id }),
        ...(secret ? { secret } : {}),
        ...(cliProvider ? { provider: cliProvider } : {})
      })
      if (generation.current !== current) return
      request.current = undefined
      await onAuthenticated(nextConfig, account)
      if (generation.current !== current) return
      cachedAccounts.delete(signature)
      if (canReadAccount) setAccountRead(undefined)
      else {
        const verifiedSignature = accountSignature(nextConfig, agent)
        const result = { status: 'signed-in' } as const
        cachedAccounts.set(verifiedSignature, result)
        setAccountRead({ signature: verifiedSignature, result })
      }
      setApiKey('')
      setMethod(undefined)
      setOpen(false)
    } catch (failure) {
      if (generation.current === current) {
        cachedAccounts.delete(signature)
        setAccountRead(undefined)
        showError(failure)
      }
    } finally {
      if (generation.current === current) {
        request.current = undefined
        setAuthPrompt(undefined)
        setAuthConsent(undefined)
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
      await onTerminalLogin?.(providerLogin && provider.trim() ? provider.trim() : undefined)
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
    const current = generation.current
    clearCopyState()
    try {
      await navigator.clipboard.writeText(authPrompt.code)
    } catch {
      if (generation.current === current) toast.error(t('common.copy_failed'))
      return
    }
    if (generation.current !== current) return
    setCopiedCode(true)
    copyTimer.current = setTimeout(() => {
      setCopiedCode(false)
      copyTimer.current = undefined
    }, 2000)
  }

  if (!available) return null
  if (
    !open &&
    ((canReadAccount && currentAccount === undefined) ||
      (sessionRequiresLogin && status === 'unknown' && modelsLoading))
  ) {
    return (
      <Badge variant="outline" role="status" className="h-8 gap-1.5 rounded-lg border-border-subtle px-2.5 text-xs">
        <Loader2 className="size-3.5 animate-spin" />
        {t('common.loading')}
      </Badge>
    )
  }
  if (!canAuthenticate && !onTerminalLogin && !onConfigureCredentials) {
    return signedIn ? (
      <Badge variant="outline" role="status" className="h-8 gap-1.5 rounded-lg border-border-subtle px-2.5 text-xs">
        <CheckCircle2 className="size-3.5 text-muted-foreground" />
        {t('local_agents.signed_in')}
      </Badge>
    ) : null
  }
  const triggerLogin = () => {
    if (!canAuthenticate && onTerminalLogin && !onConfigureCredentials) void terminalLogin()
    else if (!canAuthenticate && !onTerminalLogin && onConfigureCredentials) onConfigureCredentials()
    else if (
      needsLogin &&
      usableMethods?.length === 1 &&
      !cliOptions?.length &&
      !onTerminalLogin &&
      !onConfigureCredentials
    )
      chooseMethod(usableMethods[0].id)
    else {
      setError(undefined)
      setOpen(true)
    }
  }

  const activeCliOption = cliOptions?.find((entry) => entry.id === method)
  const loginAgentName = preset?.name ?? config.executableOverride
  const dialogTitle =
    (loginAgentName && (authConsent || (!method && preset?.auth)) ? `${loginAgentName} · ` : '') +
    (usableMethods?.find((entry) => entry.id === method)?.name ??
      (activeCliOption ? t(activeCliOption.nameKey) : undefined) ??
      t(needsLogin ? 'local_agents.sign_in' : 'local_agents.reauthenticate'))

  return (
    <>
      {signedIn ? (
        <DropdownMenu>
          <Tooltip content={accountLabel} asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 rounded-lg border-border-subtle text-xs shadow-none"
                disabled={disabled || busy}>
                <CheckCircle2 className="lucide-custom size-3.5 text-muted-foreground" />
                {t('local_agents.signed_in')}
                <ChevronDown className="lucide-custom size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end">
            {(accountLabel || identity?.workspace?.name) && (
              <DropdownMenuLabel className="max-w-72">
                {accountLabel && (
                  <Tooltip content={accountLabel} asChild>
                    <div className="truncate">{accountLabel}</div>
                  </Tooltip>
                )}
                {identity?.workspace?.name && (
                  <Tooltip content={identity.workspace.name} asChild>
                    <div className="truncate text-xs text-muted-foreground">{identity.workspace.name}</div>
                  </Tooltip>
                )}
              </DropdownMenuLabel>
            )}
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
              {authConsent ? (
                <div className="space-y-2">
                  <p role="status" className="select-text break-words text-sm">
                    {authConsent.message}
                  </p>
                  <p className="select-all break-all text-xs text-muted-foreground">{authConsent.url}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => respondToBrowserConsent('accept')}>
                      <ExternalLink className="size-4" />
                      {t('local_agents.auth_open_browser')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => respondToBrowserConsent('decline')}>
                      {t('common.decline')}
                    </Button>
                  </div>
                </div>
              ) : (
                <p role="status" className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
                  <span>
                    {account && needsKey
                      ? t('common.loading')
                      : t(
                          activeFlowKind.current === 'cli'
                            ? 'local_agents.auth_waiting_browser'
                            : 'local_agents.auth_waiting'
                        )}
                  </span>
                </p>
              )}
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
          ) : providerLogin ? (
            <form
              id="pi-provider-login"
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                void authenticate(providerLogin.id, provider)
              }}>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('local_agents.auth_pi_hint')}</p>
              <div className="flex flex-wrap gap-1.5">
                {providerLogin.suggestions.map((id) => (
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
                  {providerLogin.suggestions.map((id) => (
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
          ) : (
            <div className="flex flex-col gap-2">
              {cliOptions?.map((option) => (
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
                    {option.hintKey && (
                      <span className="block text-xs font-normal text-muted-foreground">{t(option.hintKey)}</span>
                    )}
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
              {usableMethods?.map((methodItem) => {
                const method = loginMethod(methodItem.id)
                const Icon = method ? loginIcons[method.form] : LogIn
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
                  {t('local_agents.auth_terminal_fallback')}
                </Button>
              )}
              {onConfigureCredentials && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpen(false)
                    onConfigureCredentials()
                  }}>
                  <KeyRound className="size-4" />
                  {t('settings.models.api_key')}
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
            {onTerminalLogin && canAuthenticate && !method && (busy || config.presetId !== 'opencode') && (
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
            {(method || providerLogin) && !busy && (
              <Button
                type="submit"
                form={providerLogin ? 'pi-provider-login' : 'local-agent-auth-form'}
                size="sm"
                disabled={
                  (providerLogin && !provider.trim()) ||
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
