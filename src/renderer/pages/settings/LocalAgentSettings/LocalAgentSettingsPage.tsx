import { useSearch } from '@tanstack/react-router'
import {
  ChevronDown,
  CheckCircle2,
  Download,
  Trash2,
  CircleAlert,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Search,
  X
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PageSidePanel,
  Button,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Tooltip,
  Label,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { CliModelAvatar } from '@renderer/components/Avatar/CliModelAvatar'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { LocalAgentIcon } from '@renderer/components/icons/LocalAgentIcon'
import { LocalAgentModelSelector } from '@renderer/components/LocalAgentModelSelector'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents, useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { createAgentAndRefresh } from '@renderer/services/createAgent'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import {
  LOCAL_AGENT_PRESETS,
  LocalAgentConfigurationSchema,
  type LocalAgentConfiguration,
  type LocalAgentCheckResult,
  type LocalAgentDetection,
  type LocalAgentModelCatalog,
  type LocalAgentPreset
} from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

type ModelCatalogState = { key: string; value: LocalAgentModelCatalog }

const installErrorKeys = {
  registry: 'local_agents.install_error.registry',
  unsupported: 'local_agents.install_error.unsupported',
  missing_runtime: 'local_agents.install_error.missing_runtime',
  managed_runtime: 'local_agents.install_error.managed_runtime',
  failed: 'local_agents.install_error.failed',
  not_detected: 'local_agents.install_error.not_detected',
  stopping: 'local_agents.install_error.stopping'
} as const

export function LocalAgentSettingsPage() {
  const { t } = useTranslation()
  const { agents, refetch } = useAgents({ includeDisabledLocal: true })
  const [detections, setDetections] = useState<LocalAgentDetection[]>([])
  const [detecting, setDetecting] = useState(false)
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogState>()
  const [query, setQuery] = useState('')
  const search = useSearch({ strict: false }) as { id?: string }
  const [selected, setSelected] = useState(search.id ?? 'claude')
  const refresh = useCallback(async () => {
    setDetecting(true)
    try {
      setDetections(await ipcApi.request('ai.local_agents.detect', {}))
    } catch (error) {
      toast.error(String(error))
    } finally {
      setDetecting(false)
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useIpcOn('binary.availability_changed', () => void refresh())
  const localAgents = agents.filter((a) => a.type === 'local')
  const entries = [
    ...LOCAL_AGENT_PRESETS.map((preset) => ({
      id: preset.id,
      name: localAgents.find((a) => a.configuration?.localRuntime?.presetId === preset.id)?.name ?? preset.name,
      preset,
      agent: localAgents.find((a) => a.configuration?.localRuntime?.presetId === preset.id)
    })),
    ...localAgents
      .filter((a) => !a.configuration?.localRuntime?.presetId)
      .map((agent) => ({ id: agent.id, name: agent.name, preset: undefined, agent }))
  ].sort(
    (a, b) =>
      Number(!!b.agent?.configuration?.localRuntime?.enabled) - Number(!!a.agent?.configuration?.localRuntime?.enabled)
  )
  const entry = entries.find((e) => e.id === selected || e.agent?.id === selected)
  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="flex h-full w-[248px] shrink-0 basis-[248px] flex-col border-r-[0.5px] border-border">
        <div className="px-2.5 pt-2.5">
          <InputGroup className="h-8 rounded-[10px] bg-background shadow-none">
            <InputGroupAddon className="pl-2.5">
              <Search className="lucide-custom size-3.5 text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t('common.search')}
              placeholder={t('common.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="px-1.5 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setQuery('')
                }
              }}
            />
            <InputGroupAddon align="inline-end" className="gap-0 pr-1">
              {query && (
                <Tooltip content={t('common.clear')}>
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={t('common.clear')}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setQuery('')}>
                    <X className="lucide-custom size-3 text-muted-foreground" />
                  </InputGroupButton>
                </Tooltip>
              )}
              <Tooltip content={t('local_agents.detect')}>
                <InputGroupButton
                  size="icon-xs"
                  aria-label={t('local_agents.detect')}
                  disabled={detecting}
                  onClick={() => void refresh()}>
                  <RefreshCw
                    className={cn('lucide-custom size-3.5 text-muted-foreground', detecting && 'animate-spin')}
                  />
                </InputGroupButton>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <Scrollbar className="min-h-0 flex-1 space-y-2 px-2.5 pt-2 pb-0">
          {entries
            .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
            .map((e) => {
              const enabled = e.agent?.configuration?.localRuntime?.enabled
              const detection = detections.find((d) => d.presetId === e.id)
              const executableOverride = e.agent?.configuration?.localRuntime?.executableOverride
              const notInstalled = !!detection && !detection.path && !executableOverride
              const status = notInstalled
                ? t('local_agents.not_installed')
                : enabled
                  ? t('local_agents.enabled')
                  : executableOverride
                    ? t('settings.provider.not_checked')
                    : detection?.path
                      ? t('local_agents.detected')
                      : t('local_agents.not_installed')
              return (
                <Tooltip key={e.id} content={`${e.name} · ${status}`} asChild placement="right" delay={400}>
                  <Button
                    variant="ghost"
                    className={cn(
                      'h-8 w-full justify-start gap-2.5 rounded-[10px] border border-transparent py-0 pr-2.5 pl-3 text-left font-normal shadow-none hover:bg-muted',
                      entry?.id === e.id && 'bg-muted font-medium'
                    )}
                    aria-pressed={entry?.id === e.id}
                    aria-label={`${e.name} · ${status}`}
                    onClick={() => setSelected(e.id)}>
                    <LocalAgentIcon presetId={e.preset?.id} size={26} />
                    <span className="min-w-0 flex-1 truncate text-sm leading-[1.35]">{e.name}</span>
                    {notInstalled ? (
                      <span className="shrink-0 text-xs font-normal text-foreground-tertiary">
                        {t('local_agents.not_installed')}
                      </span>
                    ) : (
                      enabled && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
                    )}
                  </Button>
                </Tooltip>
              )
            })}
          {!entries.some((e) => e.name.toLowerCase().includes(query.toLowerCase())) && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('common.no_results')}</p>
          )}
        </Scrollbar>
        <div className="shrink-0 px-2.5 pb-2.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full gap-1.5 text-xs shadow-none"
            onClick={() => setSelected('custom-new')}>
            <Plus className="size-3.5" />
            {t('local_agents.custom')}
          </Button>
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <LocalAgentEditor
          key={`${entry?.agent?.id ?? selected}:${entry?.agent?.updatedAt ?? ''}`}
          modelCatalog={modelCatalog}
          onModelCatalog={setModelCatalog}
          preset={entry?.preset}
          agent={entry?.agent}
          detection={detections.find((d) => d.presetId === entry?.preset?.id)}
          onSaved={async (id) => {
            await refetch()
            setSelected(id)
            await refresh()
          }}
        />
      </main>
    </div>
  )
}

function LocalAgentEditor({
  modelCatalog,
  onModelCatalog,
  preset,
  agent,
  detection,
  onSaved
}: {
  preset?: LocalAgentPreset
  agent?: AgentEntity
  detection?: LocalAgentDetection
  modelCatalog?: ModelCatalogState
  onModelCatalog: (catalog: ModelCatalogState) => void
  onSaved: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const { updateAgent } = useUpdateAgent()
  const initial: LocalAgentConfiguration = agent?.configuration?.localRuntime ?? {
    protocol: preset?.protocol ?? 'acp',
    presetId: preset?.id,
    enabled: false,
    args: [],
    env: {}
  }
  const [config, setConfig] = useState(initial)
  const [name, setName] = useState(agent?.name ?? preset?.name ?? '')
  const [args, setArgs] = useState(JSON.stringify(initial.args.length ? initial.args : (preset?.args ?? [])))
  const [env, setEnv] = useState(JSON.stringify(initial.env, null, 2))
  const [busyAction, setBusyAction] = useState<
    'save' | 'check' | 'toggle' | 'install' | 'uninstall' | 'confirm-uninstall' | 'models' | 'model'
  >()
  const catalogKey = JSON.stringify([
    initial.presetId,
    initial.protocol,
    initial.executableOverride,
    detection?.path,
    detection?.version,
    initial.args,
    initial.env
  ])
  const catalog = modelCatalog?.key === catalogKey ? modelCatalog.value : undefined
  const busy = busyAction !== undefined
  const [result, setResult] = useState<string>()
  const [resultOk, setResultOk] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editing, setEditing] = useState(!preset && !agent)
  const [confirmClose, setConfirmClose] = useState(false)
  const openEditor = () => {
    setConfig(initial)
    setName(agent?.name ?? preset?.name ?? '')
    setArgs(JSON.stringify(initial.args.length ? initial.args : (preset?.args ?? [])))
    setEnv(JSON.stringify(initial.env, null, 2))
    setDirty(false)
    setConfirmClose(false)
    setResult(undefined)
    setEditing(true)
  }
  const closeEditor = () => {
    if (busy) return
    if (dirty) setConfirmClose(true)
    else setEditing(false)
  }
  const parsed = () => LocalAgentConfigurationSchema.parse({ ...config, args: JSON.parse(args), env: JSON.parse(env) })
  const checkError = (response: LocalAgentCheckResult) =>
    response.status === 'not-installed'
      ? t('local_agents.install_required')
      : [
          response.status === 'authentication-required'
            ? t('local_agents.login_required')
            : response.status === 'incompatible'
              ? t('local_agents.incompatible')
              : t('common.error'),
          response.error
        ]
          .filter(Boolean)
          .join('\n')
  const loadModels = async () => {
    if (busy) return
    setBusyAction('models')
    setResult(undefined)
    try {
      const value = await ipcApi.request('ai.local_agents.models', initial)
      onModelCatalog({ key: catalogKey, value })
    } catch (error) {
      setResultOk(false)
      setResult(String(error))
    } finally {
      setBusyAction(undefined)
    }
  }
  const selectModel = async (nativeModel?: string) => {
    if (busy) return false
    if (nativeModel === initial.nativeModel) return true
    setBusyAction('model')
    setResult(undefined)
    try {
      const localRuntime = { ...initial, nativeModel }
      const updated = agent
        ? await updateAgent({ id: agent.id, configuration: { localRuntime } })
        : await createAgentAndRefresh(
            { type: 'local', name: preset!.name, model: null, configuration: { localRuntime } },
            async () => {}
          )
      if (updated) {
        toast.success(t('common.saved'))
        await onSaved(updated.id)
      }
      return !!updated
    } catch (error) {
      setResultOk(false)
      setResult(String(error))
      return false
    } finally {
      setBusyAction(undefined)
    }
  }
  const install = async () => {
    if (!preset || busy) return
    setBusyAction('install')
    setResult(undefined)
    try {
      const response = await ipcApi.request('ai.local_agents.install', { presetId: preset.id })
      setResultOk(response.ok)
      setResult(
        response.ok
          ? `${t('local_agents.install_success')}\n${response.path}`
          : [t(installErrorKeys[response.reason], { manager: response.manager ?? '' }), response.detail]
              .filter(Boolean)
              .join('\n')
      )
    } catch (error) {
      setResultOk(false)
      setResult(String(error))
    } finally {
      setBusyAction(undefined)
    }
  }
  const uninstall = async () => {
    if (!preset || !detection?.path || busy) return
    const expectedPath = detection.path
    setBusyAction('confirm-uninstall')
    try {
      if (
        !(await popup.confirm({
          title: t('local_agents.uninstall_title', { name: preset.name }),
          content: (
            <div className="space-y-3">
              <p>{t('local_agents.uninstall_confirm')}</p>
              <p className="break-all text-xs text-muted-foreground">{expectedPath}</p>
            </div>
          ),
          okText: t('local_agents.uninstall'),
          okButtonProps: { danger: true }
        }))
      )
        return
      setResult(undefined)
      setBusyAction('uninstall')
      const response = await ipcApi.request('ai.local_agents.uninstall', { presetId: preset.id, expectedPath })
      setResultOk(response.ok)
      setResult(
        response.ok
          ? t('local_agents.uninstall_success')
          : [t(`local_agents.uninstall_error.${response.reason}`), response.detail].filter(Boolean).join('\n')
      )
    } catch (error) {
      setResultOk(false)
      setResult(String(error))
    } finally {
      setBusyAction(undefined)
    }
  }
  const check = async () => {
    setBusyAction('check')
    try {
      const response = await ipcApi.request('ai.local_agents.check', initial)
      setResultOk(response.ok)
      setResult(
        response.ok
          ? [t('local_agents.connected'), response.version, response.path].filter(Boolean).join('\n')
          : checkError(response)
      )
    } catch (error) {
      setResultOk(false)
      setResult(String(error))
    } finally {
      setBusyAction(undefined)
    }
  }
  const save = async (enabled?: boolean) => {
    if (busy) return
    setBusyAction(enabled === undefined ? 'save' : 'toggle')
    setResult(undefined)
    try {
      const localRuntime = enabled === undefined ? parsed() : { ...initial, enabled }
      const savedName = enabled === undefined ? name.trim() : (agent?.name ?? preset?.name ?? '')
      if (!savedName) throw new Error(t('local_agents.name_required'))
      if (localRuntime.enabled || (!preset && !agent)) {
        const response = await ipcApi.request('ai.local_agents.check', localRuntime)
        if (!response.ok) {
          setResultOk(false)
          setResult(checkError(response))
          return
        }
      }
      const updated = agent
        ? await updateAgent({ id: agent.id, name: savedName, configuration: { localRuntime } })
        : await createAgentAndRefresh(
            { type: 'local', name: savedName, model: null, configuration: { localRuntime } },
            async () => {}
          )
      if (updated) {
        setDirty(false)
        setEditing(false)
        toast.success(t('common.saved'))
        await onSaved(updated.id)
      }
    } catch (error) {
      setResultOk(false)
      setResult(String(error))
    } finally {
      setBusyAction(undefined)
    }
  }
  const pathField = (
    <div className="space-y-2">
      <Label htmlFor="local-agent-path">{t('local_agents.executable')}</Label>
      <Input
        id="local-agent-path"
        className="h-8 font-mono text-xs"
        placeholder={detection?.path ?? preset?.executable}
        value={config.executableOverride ?? ''}
        onChange={(e) => setConfig({ ...config, executableOverride: e.target.value || undefined })}
      />
    </div>
  )
  const feedback = result && (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 text-xs',
        resultOk
          ? 'border-success-border bg-success-subtle text-success-subtle-foreground'
          : 'border-error-border bg-error-subtle text-error-subtle-foreground'
      )}>
      {resultOk ? <CheckCircle2 className="size-4 shrink-0" /> : <CircleAlert className="size-4 shrink-0" />}
      <p className="min-w-0 whitespace-pre-wrap break-words">{result}</p>
    </div>
  )
  return (
    <>
      <header className="shrink-0 px-6 py-2.5">
        <div className="mx-auto flex min-h-7 w-full max-w-3xl items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <h1 className="truncate text-[15px] leading-tight font-semibold">
              {agent?.name ?? preset?.name ?? t('local_agents.custom')}
            </h1>
            <Tooltip content={t('common.advanced_settings')} asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 rounded-lg text-foreground-tertiary hover:text-foreground"
                aria-label={t('common.advanced_settings')}
                disabled={busy}
                onClick={openEditor}>
                <Settings2 className="lucide-custom size-3.5 text-muted-foreground" />
              </Button>
            </Tooltip>
          </div>
          {busyAction === 'toggle' && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          <Switch
            aria-label={t('local_agents.enable')}
            checked={initial.enabled}
            disabled={busy || (!preset && !agent)}
            onCheckedChange={(enabled) => void save(enabled)}
          />
        </div>
      </header>
      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden px-6 pt-1.5 pb-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <p className="text-xs leading-relaxed text-muted-foreground">{t('local_agents.description')}</p>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm leading-[1.3] font-medium">{t('local_agents.executable')}</h2>
              <span className="text-xs text-muted-foreground">
                {initial.executableOverride
                  ? t('settings.provider.not_checked')
                  : detection?.path
                    ? t('local_agents.detected')
                    : t('local_agents.not_installed')}
              </span>
            </div>
            {(initial.executableOverride ?? detection?.path ?? preset?.executable) && (
              <div className="flex min-h-8 items-center rounded-lg border border-border-subtle bg-muted/30 px-2.5 py-1.5">
                <p className="min-w-0 break-all font-mono text-xs text-foreground">
                  {initial.executableOverride ?? detection?.path ?? preset?.executable}
                </p>
              </div>
            )}
            {!initial.executableOverride && detection?.path && (
              <p className="text-xs text-foreground-tertiary">
                {detection.source === 'mise' ? 'CodeMate' : t('settings.dependencies.source.system')}
                {detection.version && ` · ${detection.version}`}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {preset && !detection?.path && !initial.executableOverride && (
                <Button size="sm" className="h-8 rounded-lg text-xs" disabled={busy} onClick={() => void install()}>
                  {busyAction === 'install' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  {t(busyAction === 'install' ? 'local_agents.installing' : 'local_agents.install')}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg border-border-subtle text-xs shadow-none"
                disabled={busy || (!preset && !agent)}
                onClick={() => void check()}>
                <RefreshCw
                  className={cn(
                    'lucide-custom size-3.5 text-muted-foreground',
                    busyAction === 'check' && 'animate-spin'
                  )}
                />
                {t('local_agents.check')}
              </Button>
              {preset ? (
                <a
                  className={cn(
                    'inline-flex items-center gap-1.5 text-xs text-link hover:underline',
                    !detection?.path && !initial.executableOverride && 'font-medium'
                  )}
                  href={preset.helpUrl}
                  target="_blank"
                  rel="noreferrer">
                  {t('local_agents.help')}
                  <ExternalLink className="size-3" />
                </a>
              ) : (
                !agent && (
                  <Button size="sm" onClick={openEditor}>
                    {t('common.settings')}
                  </Button>
                )
              )}
            </div>
            {preset && !detection?.path && !initial.executableOverride && (
              <p className="text-xs leading-relaxed text-muted-foreground">{t('local_agents.install_hint')}</p>
            )}
            {(preset || agent) && (
              <div className="space-y-2 pt-3">
                <Label id="local-agent-model-label">{t('common.model')}</Label>
                <LocalAgentModelSelector
                  models={catalog?.models ?? []}
                  value={initial.nativeModel}
                  disabled={busy && busyAction !== 'models'}
                  loading={busyAction === 'models'}
                  loaded={!!catalog}
                  loadDisabled={!detection?.path && !initial.executableOverride}
                  onLoad={loadModels}
                  onSelect={selectModel}
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      aria-labelledby="local-agent-model-label"
                      disabled={busy}
                      className="h-8 w-72 min-w-0 max-w-full justify-start gap-2 text-xs font-normal">
                      {initial.nativeModel ? (
                        <ModelAvatar
                          model={{
                            id: initial.nativeModel,
                            name:
                              catalog?.models.find((model) => model.id === initial.nativeModel)?.name ||
                              initial.nativeModel
                          }}
                          size={20}
                        />
                      ) : (
                        <CliModelAvatar />
                      )}
                      <span className="min-w-0 flex-1 truncate text-left">
                        {initial.nativeModel
                          ? catalog?.models.find((model) => model.id === initial.nativeModel)?.name ||
                            initial.nativeModel
                          : t('local_agents.follow_cli')}
                      </span>
                      {busy ? (
                        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      )}
                    </Button>
                  }
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(catalog?.models.length === 0 ? 'local_agents.models_unavailable' : 'local_agents.model_hint')}
                </p>
              </div>
            )}
            {!editing && feedback}
          </section>
        </div>
      </Scrollbar>
      <PageSidePanel
        open={editing}
        onClose={closeEditor}
        title={t('common.advanced_settings')}
        closeLabel={t('common.close')}
        footer={
          <div className="space-y-3">
            {confirmClose ? (
              <div className="space-y-2" role="alert">
                <p className="text-sm">{t('agent.preview_pane.edit.leave.title')}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setConfirmClose(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setDirty(false)
                      setEditing(false)
                      setConfirmClose(false)
                      setResult(undefined)
                    }}>
                    {t('agent.preview_pane.edit.discard')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-2">
                {preset && detection?.path && !initial.executableOverride && (
                  <Button variant="outline" className="mr-auto" disabled={busy} onClick={() => void uninstall()}>
                    {busyAction === 'uninstall' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="lucide-custom size-4 text-muted-foreground" />
                    )}
                    {t(busyAction === 'uninstall' ? 'local_agents.uninstalling' : 'local_agents.uninstall')}
                  </Button>
                )}
                <Button variant="outline" disabled={busy} onClick={closeEditor}>
                  {t('common.cancel')}
                </Button>
                <Button disabled={busy || (!dirty && !!agent)} onClick={() => void save()}>
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
            setResult(undefined)
          }}>
          <div className="space-y-2">
            <Label htmlFor="local-agent-name">{t('common.name')}</Label>
            <Input id="local-agent-name" className="h-8" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {pathField}
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
    </>
  )
}
