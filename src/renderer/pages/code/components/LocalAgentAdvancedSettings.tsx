import { Loader2, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Input,
  Label,
  PageSidePanel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@cherrystudio/ui'
import {
  getLocalAgentProtocol,
  LocalAgentConfigurationSchema,
  resolveLocalAgentBrowserControl,
  type LocalAgentBrowserControlMode,
  type LocalAgentConfiguration,
  type LocalAgentDetection,
  type LocalAgentPreset
} from '@shared/ai/localAgent'

export function LocalAgentAdvancedSettings({
  config,
  name: savedName,
  preset,
  detection,
  hasAgent,
  restoring,
  busyAction,
  pendingSelection,
  feedback,
  onClose,
  onCancelNavigation,
  onChange,
  onError,
  onUninstall,
  onSave
}: {
  config: LocalAgentConfiguration
  name: string
  preset?: LocalAgentPreset
  detection?: LocalAgentDetection
  hasAgent: boolean
  restoring?: boolean
  busyAction?: 'save' | 'check' | 'toggle' | 'install' | 'uninstall' | 'confirm-uninstall' | 'model' | 'terminal'
  pendingSelection?: string
  feedback?: ReactNode
  onClose: () => void
  onCancelNavigation: () => void
  onChange: () => void
  onError: (error: string) => void
  onUninstall: () => Promise<void>
  onSave: (config: Partial<LocalAgentConfiguration>, name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [executableOverride, setExecutableOverride] = useState(config.executableOverride)
  const [name, setName] = useState(savedName)
  const [args, setArgs] = useState(JSON.stringify(config.args.length ? config.args : (preset?.args ?? [])))
  const [env, setEnv] = useState(JSON.stringify(config.env, null, 2))
  const [browserControl, setBrowserControl] = useState<LocalAgentBrowserControlMode>(() =>
    resolveLocalAgentBrowserControl(config)
  )
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const busy = busyAction !== undefined
  const sdk = getLocalAgentProtocol(config.presetId) === 'cursor'
  const close = () => {
    if (busy) return
    if (dirty) setConfirmClose(true)
    else setOpen(false)
  }
  const requestNavigation = useEffectEvent(close)
  useEffect(() => {
    if (pendingSelection && !busy) requestNavigation()
  }, [pendingSelection, busy])
  const save = async () => {
    if (busy) return
    onChange()
    let parsedArgs: unknown
    let parsedEnv: unknown
    try {
      parsedArgs = JSON.parse(args)
    } catch {
      onError(t('local_agents.arguments_invalid'))
      return
    }
    try {
      parsedEnv = JSON.parse(env)
    } catch {
      onError(t('local_agents.environment_invalid'))
      return
    }
    const parsed = LocalAgentConfigurationSchema.pick({ args: true, env: true }).safeParse({
      args: parsedArgs,
      env: parsedEnv
    })
    if (!parsed.success) {
      onError(
        t(
          parsed.error.issues[0].path[0] === 'args'
            ? 'local_agents.arguments_invalid'
            : 'local_agents.environment_invalid'
        )
      )
      return
    }
    if (
      await onSave(
        {
          executableOverride,
          ...parsed.data,
          ...(config.browserControl !== undefined || browserControl !== resolveLocalAgentBrowserControl(config)
            ? { browserControl }
            : {})
        },
        name.trim()
      )
    )
      setOpen(false)
  }
  return (
    <PageSidePanel
      open={open}
      onClose={close}
      onExitComplete={onClose}
      title={t('common.advanced_settings')}
      headerClassName="pb-0"
      bodyClassName="pt-0"
      closeLabel={t('common.close')}
      footer={
        <div className="space-y-3">
          {confirmClose ? (
            <div className="space-y-2" role="alert">
              <p className="text-sm">{t('agent.preview_pane.edit.leave.title')}</p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirmClose(false)
                    onCancelNavigation()
                  }}>
                  {t('common.cancel')}
                </Button>
                <Button variant="destructive" onClick={() => setOpen(false)}>
                  {t('agent.preview_pane.edit.discard')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              {preset && detection?.path && !config.executableOverride && (
                <Button variant="outline" className="mr-auto" disabled={busy} onClick={() => void onUninstall()}>
                  {busyAction === 'uninstall' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="lucide-custom size-4 text-muted-foreground" />
                  )}
                  {t(busyAction === 'uninstall' ? 'local_agents.uninstalling' : 'local_agents.uninstall')}
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button disabled={busy || (!dirty && hasAgent)} onClick={() => void save()}>
                {busyAction === 'save' && <Loader2 className="size-4 animate-spin" />}
                {t(restoring ? 'local_agents.enable' : 'common.save')}
              </Button>
            </div>
          )}
        </div>
      }>
      {!sdk && <p className="text-xs leading-relaxed text-muted-foreground">{t('local_agents.advanced_hint')}</p>}
      <fieldset
        disabled={busy}
        className="min-w-0 space-y-5"
        onChange={() => {
          setDirty(true)
          setConfirmClose(false)
          onChange()
        }}>
        <div className="space-y-2">
          <Label htmlFor="local-agent-name">{t('common.name')}</Label>
          <Input
            id="local-agent-name"
            className="h-8"
            disabled={!!preset || restoring}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {!sdk && (
          <>
            <div className="space-y-2">
              <Label htmlFor="local-agent-path">{t('local_agents.executable')}</Label>
              <Input
                id="local-agent-path"
                className="h-8 font-mono text-xs"
                placeholder={detection?.path ?? preset?.executable}
                value={executableOverride ?? ''}
                onChange={(e) => setExecutableOverride(e.target.value || undefined)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="local-agent-args">{t('local_agents.arguments')}</Label>
              <Textarea.Input
                id="local-agent-args"
                className="min-h-16 font-mono text-xs"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                spellCheck={false}
              />
            </div>
          </>
        )}
        <div className="space-y-2">
          <Label htmlFor="local-agent-env">{t('local_agents.environment')}</Label>
          {preset?.credentialEnvironment && (
            <p className="break-words font-mono text-xs text-muted-foreground">
              {preset.credentialEnvironment.join(' · ')}
            </p>
          )}
          <Textarea.Input
            id="local-agent-env"
            className="min-h-24 font-mono text-xs"
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="local-agent-browser-control">{t('local_agents.browser_control')}</Label>
          <Select
            disabled={busy}
            value={browserControl}
            onValueChange={(next) => {
              setBrowserControl(next as LocalAgentBrowserControlMode)
              setDirty(true)
              setConfirmClose(false)
              onChange()
            }}>
            <SelectTrigger
              id="local-agent-browser-control"
              size="sm"
              className="h-8 w-full"
              aria-label={t('local_agents.browser_control')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">{t('local_agents.browser_control_inherit')}</SelectItem>
              <SelectItem value="readonly">{t('local_agents.browser_control_readonly')}</SelectItem>
              <SelectItem value="disabled">{t('local_agents.browser_control_disabled')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(
              config.presetId === undefined
                ? 'local_agents.browser_control_custom_hint'
                : 'local_agents.browser_control_hint'
            )}
          </p>
        </div>
      </fieldset>
      {feedback}
    </PageSidePanel>
  )
}
