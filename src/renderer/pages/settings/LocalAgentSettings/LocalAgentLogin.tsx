import { Loader2, LogIn } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

export function LocalAgentLogin({
  config,
  disabled,
  helpUrl,
  onAuthenticated
}: {
  config: LocalAgentConfiguration
  disabled: boolean
  helpUrl?: string
  onAuthenticated: (config: LocalAgentConfiguration) => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [methods, setMethods] = useState<Array<{ id: string; name: string }>>([])
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
  const cancel = () => {
    generation.current++
    const requestId = request.current
    request.current = undefined
    if (requestId) void ipcApi.request('ai.local_agents.cancel_auth', { requestId }).catch(() => undefined)
    setBusy(false)
    setApiKey('')
    setMethod(undefined)
  }
  useEffect(
    () => () => {
      generation.current++
      const requestId = request.current
      if (requestId) void ipcApi.request('ai.local_agents.cancel_auth', { requestId }).catch(() => undefined)
    },
    []
  )
  const showError = (failure: unknown) => {
    const message = failure instanceof Error ? failure.message : String(failure)
    setError(
      /not (?:currently )?available in your (?:location|region)/i.test(message)
        ? t('local_agents.auth_region_unavailable')
        : /timed out/i.test(message)
          ? t('error.request_timeout')
          : message.replace(/^(?:IpcError|Error):\s*/, '')
    )
  }
  const discover = async () => {
    const current = ++generation.current
    setOpen(true)
    setBusy(true)
    setError(undefined)
    setMethods([])
    setMethod(undefined)
    setApiKey('')
    try {
      const result = await ipcApi.request('ai.local_agents.check', config)
      if (generation.current !== current) return
      if (!result.ok) throw new Error(result.error)
      setMethods(result.protocolInfo?.authMethods ?? [])
    } catch (failure) {
      if (generation.current === current) showError(failure)
    } finally {
      if (generation.current === current) setBusy(false)
    }
  }
  const chooseMethod = (methodId: string) => {
    if (
      config.presetId !== 'antigravity-acp' ||
      !['gemini-api-key', 'agent-platform', 'oauth-business'].includes(methodId)
    ) {
      void authenticate(methodId)
      return
    }
    setMethod(methodId)
    setError(undefined)
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
      setApiKey('')
      setOpen(false)
    } catch (failure) {
      if (generation.current === current) showError(failure)
    } finally {
      if (generation.current === current) {
        request.current = undefined
        setBusy(false)
      }
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 shrink-0 rounded-lg border-border-subtle text-xs shadow-none"
        disabled={disabled || busy}
        onClick={() => void discover()}>
        <LogIn className="lucide-custom size-3.5 text-muted-foreground" />
        {t('local_agents.sign_in')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) cancel()
          setOpen(next)
        }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('local_agents.sign_in')}</DialogTitle>
          </DialogHeader>
          {busy ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t(request.current && !needsKey && !platform ? 'local_agents.auth_waiting' : 'common.loading')}
            </p>
          ) : method ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">{methods.find((entry) => entry.id === method)?.name}</p>
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
              {methods.map((method) => (
                <Button key={method.id} variant="outline" onClick={() => chooseMethod(method.id)}>
                  {method.name}
                </Button>
              ))}
              {!methods.length && !error && (
                <p className="text-sm text-muted-foreground">{t('local_agents.auth_external')}</p>
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
