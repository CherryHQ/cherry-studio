import { Loader2, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input, Label, PageSidePanel, Textarea } from '@cherrystudio/ui'
import {
  LocalAgentConfigurationSchema,
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
  busyAction?: 'save' | 'check' | 'toggle' | 'install' | 'uninstall' | 'confirm-uninstall' | 'model'
  pendingSelection?: string
  feedback?: ReactNode
  onClose: () => void
  onCancelNavigation: () => void
  onChange: () => void
  onError: (error: string) => void
  onUninstall: () => Promise<void>
  onSave: (config: LocalAgentConfiguration, name: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [draftConfig, setDraftConfig] = useState(config)
  const [name, setName] = useState(savedName)
  const [args, setArgs] = useState(JSON.stringify(config.args.length ? config.args : (preset?.args ?? [])))
  const [env, setEnv] = useState(JSON.stringify(config.env, null, 2))
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const busy = busyAction !== undefined
  const close = () => {
    if (busy) return
    if (dirty) setConfirmClose(true)
    else onClose()
  }
  const requestNavigation = useEffectEvent(close)
  useEffect(() => {
    if (pendingSelection && !busy) requestNavigation()
  }, [pendingSelection, busy])
  const save = async () => {
    if (busy) return
    onChange()
    try {
      const localRuntime = LocalAgentConfigurationSchema.parse({
        ...draftConfig,
        args: JSON.parse(args),
        env: JSON.parse(env)
      })
      if (await onSave(localRuntime, name.trim())) onClose()
    } catch (error) {
      onError(String(error))
    }
  }
  return (
    <PageSidePanel
      open
      onClose={close}
      title={t('common.advanced_settings')}
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
                <Button variant="destructive" onClick={onClose}>
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
                {t('common.save')}
              </Button>
            </div>
          )}
        </div>
      }>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('local_agents.advanced_hint')}</p>
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
          <Input id="local-agent-name" className="h-8" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="local-agent-path">{t('local_agents.executable')}</Label>
          <Input
            id="local-agent-path"
            className="h-8 font-mono text-xs"
            placeholder={detection?.path ?? preset?.executable}
            value={draftConfig.executableOverride ?? ''}
            onChange={(e) => setDraftConfig({ ...draftConfig, executableOverride: e.target.value || undefined })}
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
        <div className="space-y-2">
          <Label htmlFor="local-agent-env">{t('local_agents.environment')}</Label>
          <Textarea.Input
            id="local-agent-env"
            className="min-h-24 font-mono text-xs"
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            spellCheck={false}
          />
        </div>
      </fieldset>
      {feedback}
    </PageSidePanel>
  )
}
