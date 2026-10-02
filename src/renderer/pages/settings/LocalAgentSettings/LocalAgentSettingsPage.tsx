import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  CheckCircle2,
  Download,
  CircleAlert,
  Loader2,
  MessageSquare,
  Plus,
  PlugZap,
  RefreshCw,
  Settings2,
  SquareTerminal,
  Search,
  X
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Tooltip,
  Switch
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { LocalAgentIcon } from '@renderer/components/icons/LocalAgentIcon'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAgents, useUpdateAgent } from '@renderer/hooks/agent/useAgent'
import { useLocalAgentModelCatalog } from '@renderer/hooks/agent/useLocalAgentModelCatalog'
import { useCurrentTabId, useOptionalTabsContext } from '@renderer/hooks/tab'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { createAgentAndRefresh } from '@renderer/services/createAgent'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { classifyLocalAgentError } from '@renderer/utils/agent/localAgentError'
import { resolveAgentEntrySessionIdForAgent } from '@renderer/utils/conversationEntry'
import { findConversationTab } from '@renderer/utils/conversationNavigation'
import { getSidebarApp, tabBelongsToApp } from '@renderer/utils/sidebar'
import {
  LOCAL_AGENT_PRESETS,
  type LocalAgentConfiguration,
  type LocalAgentCheckResult,
  type LocalAgentDetection,
  type LocalAgentPreset
} from '@shared/ai/localAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

import { LocalAgentAdvancedSettings } from './LocalAgentAdvancedSettings'
import { LocalAgentLogin } from './LocalAgentLogin'
import { LocalAgentModelList } from './LocalAgentModelList'

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
  const [query, setQuery] = useState('')
  const search = useSearch({ strict: false }) as { id?: string }
  const navigate = useNavigate()
  const [selected, setSelected] = useState(search.id ?? 'claude')
  const [pendingSelection, setPendingSelection] = useState<string>()
  useEffect(() => {
    if (search.id) setPendingSelection(search.id)
  }, [search.id])
  const navigateToSelection = useCallback(() => {
    if (pendingSelection) {
      setSelected(pendingSelection)
      void navigate({ to: '/settings/local-agents', search: { id: pendingSelection }, replace: true })
    }
    setPendingSelection(undefined)
  }, [navigate, pendingSelection])
  const cancelNavigation = useCallback(() => {
    setPendingSelection(undefined)
    void navigate({ to: '/settings/local-agents', search: { id: selected }, replace: true })
  }, [navigate, selected])
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
        <Scrollbar className="min-h-0 flex-1 space-y-2 px-2.5 pt-2 pb-2.5">
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
                <Button
                  key={e.id}
                  variant="ghost"
                  className={cn(
                    'h-8 w-full justify-start gap-2.5 rounded-[10px] border border-transparent py-0 pr-2.5 pl-3 text-left font-normal shadow-none hover:bg-muted',
                    entry?.id === e.id && 'bg-muted font-medium'
                  )}
                  aria-pressed={entry?.id === e.id}
                  aria-label={`${e.name} · ${status}`}
                  onClick={() => setPendingSelection(e.id)}>
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
            onClick={() => setPendingSelection('custom-new')}>
            <Plus className="size-3.5" />
            {t('local_agents.custom')}
          </Button>
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <LocalAgentDetails
          key={entry?.id ?? selected}
          pendingSelection={
            pendingSelection &&
            pendingSelection !== selected &&
            pendingSelection !== entry?.id &&
            pendingSelection !== entry?.agent?.id
              ? pendingSelection
              : undefined
          }
          onNavigate={navigateToSelection}
          onCancelNavigation={cancelNavigation}
          preset={entry?.preset}
          agent={entry?.agent}
          detection={detections.find((d) => d.presetId === entry?.preset?.id)}
          onSaved={async (id, refreshInstallations = true) => {
            await refetch()
            setSelected(id)
            void navigate({ to: '/settings/local-agents', search: { id }, replace: true })
            if (refreshInstallations) await refresh()
          }}
        />
      </main>
    </div>
  )
}

function LocalAgentDetails({
  pendingSelection,
  onNavigate,
  onCancelNavigation,
  preset,
  agent,
  detection,
  onSaved
}: {
  pendingSelection?: string
  onNavigate: () => void
  onCancelNavigation: () => void
  preset?: LocalAgentPreset
  agent?: AgentEntity
  detection?: LocalAgentDetection
  onSaved: (id: string, refreshInstallations?: boolean) => Promise<void>
}) {
  const { t } = useTranslation()
  const { updateAgent } = useUpdateAgent()
  const tabs = useOptionalTabsContext()
  const currentTabId = useCurrentTabId()
  const initial: LocalAgentConfiguration = agent?.configuration?.localRuntime ?? {
    protocol: preset?.protocol ?? 'acp',
    presetId: preset?.id,
    enabled: false,
    args: [],
    env: {}
  }
  const [busyAction, setBusyAction] = useState<
    'save' | 'check' | 'toggle' | 'install' | 'uninstall' | 'confirm-uninstall' | 'model' | 'terminal'
  >()
  const {
    catalog,
    loading: modelsLoading,
    error: modelsError,
    refresh: refreshModels
  } = useLocalAgentModelCatalog(
    preset?.id ?? agent?.id ?? 'custom-new',
    initial,
    !!(detection?.path || initial.executableOverride)
  )
  const [openingChat, setOpeningChat] = useState(false)
  const available = !!(detection?.path || initial.executableOverride)
  const busy = busyAction !== undefined || openingChat
  const modelSavingClass =
    busyAction === 'model' ? '[&_button:disabled]:pointer-events-auto [&_button:disabled]:opacity-100' : undefined
  const [result, setResult] = useState<{ message?: string; ok: boolean }>({ ok: false })
  const clearResult = () => setResult(({ ok }) => ({ ok }))
  const showError = (error: unknown) => setResult({ ok: false, message: String(error) })
  const [connection, setConnection] = useState<Pick<LocalAgentCheckResult, 'status' | 'version'>>()
  const [programHovered, setProgramHovered] = useState(false)
  const feedbackTimer = useRef({ connection, remaining: 4000 })
  useEffect(() => {
    if (feedbackTimer.current.connection !== connection) feedbackTimer.current = { connection, remaining: 4000 }
    if (connection?.status !== 'ready' || programHovered) return
    const started = Date.now()
    const timer = setTimeout(() => setConnection(undefined), feedbackTimer.current.remaining)
    return () => {
      clearTimeout(timer)
      feedbackTimer.current.remaining = Math.max(0, feedbackTimer.current.remaining - (Date.now() - started))
    }
  }, [connection, programHovered])
  const [editing, setEditing] = useState(!preset && !agent)
  useEffect(() => {
    if (pendingSelection && !editing && !busy) onNavigate()
  }, [pendingSelection, editing, busy, onNavigate])
  const openTerminal = async () => {
    if (busy) return
    setBusyAction('terminal')
    try {
      const response = await ipcApi.request('ai.local_agents.open_terminal', initial)
      if (!response.success) toast.error(response.message ?? t('common.error'))
    } catch (error) {
      toast.error(String(error))
    } finally {
      setBusyAction(undefined)
    }
  }
  const openEditor = () => {
    setConnection(undefined)
    clearResult()
    setEditing(true)
  }
  const closeEditor = () => {
    setEditing(false)
    clearResult()
    if (pendingSelection) onNavigate()
  }
  const persistLocalRuntime = (localRuntime: LocalAgentConfiguration, name?: string) =>
    agent
      ? updateAgent({ id: agent.id, name, configuration: { localRuntime } }, { showSuccessToast: false })
      : createAgentAndRefresh(
          { type: 'local', name: name ?? preset?.name ?? '', model: null, configuration: { localRuntime } },
          async () => {}
        )
  const goToChat = async () => {
    if (busy || !agent || !initial.enabled) return
    if (!tabs || !currentTabId) {
      openRoute('/app/agents', { agentId: agent.id })
      return
    }
    setOpeningChat(true)
    try {
      const sessionId = await resolveAgentEntrySessionIdForAgent(agent.id)
      const app = getSidebarApp('agents')!
      const url = sessionId
        ? app.conversationRoute!.urlForKey(sessionId)
        : `/app/agents?agentId=${encodeURIComponent(agent.id)}`
      const target =
        (sessionId && findConversationTab(tabs.tabs, { conversationType: 'agent', conversationId: sessionId })) ||
        tabs.tabs
          .filter((tab) => tab.type === 'route' && tabBelongsToApp(app, tab.url))
          .sort((a, b) => (b.lastAccessTime ?? 0) - (a.lastAccessTime ?? 0))[0]
      if (target) {
        if (target.url !== url) tabs.updateTab(target.id, { url, title: agent.name })
        tabs.closeTabs([currentTabId], target.id)
        tabs.setActiveTab(target.id)
      } else {
        tabs.updateTab(currentTabId, { url, title: agent.name })
      }
    } catch (error) {
      toast.error(String(error))
    } finally {
      setOpeningChat(false)
    }
  }
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
    clearResult()
    try {
      await refreshModels()
    } catch (error) {
      showError(error)
    }
  }
  const selectModel = async (nativeModel?: string) => {
    if (busy) return false
    if (nativeModel === initial.nativeModel) return true
    setBusyAction('model')
    clearResult()
    try {
      const localRuntime = { ...initial, nativeModel }
      const updated = await persistLocalRuntime(localRuntime)
      if (updated) await onSaved(updated.id, false)
      return !!updated
    } catch (error) {
      showError(error)
      return false
    } finally {
      setBusyAction(undefined)
    }
  }
  const install = async () => {
    if (!preset || busy) return
    setBusyAction('install')
    clearResult()
    try {
      const response = await ipcApi.request('ai.local_agents.install', { presetId: preset.id })
      setResult({
        ok: response.ok,
        message: response.ok
          ? `${t('local_agents.install_success')}\n${response.path}`
          : [t(installErrorKeys[response.reason], { manager: response.manager ?? '' }), response.detail]
              .filter(Boolean)
              .join('\n')
      })
    } catch (error) {
      showError(error)
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
      clearResult()
      setBusyAction('uninstall')
      const response = await ipcApi.request('ai.local_agents.uninstall', { presetId: preset.id, expectedPath })
      setResult({
        ok: response.ok,
        message: response.ok
          ? t('local_agents.uninstall_success')
          : [t(`local_agents.uninstall_error.${response.reason}`), response.detail].filter(Boolean).join('\n')
      })
    } catch (error) {
      showError(error)
    } finally {
      setBusyAction(undefined)
    }
  }
  const check = async () => {
    if (busy) return
    setBusyAction('check')
    setConnection(undefined)
    clearResult()
    try {
      const response = await ipcApi.request('ai.local_agents.check', initial)
      setConnection({ status: response.status, version: response.version ?? response.protocolInfo?.agent?.version })
      setResult({ ok: response.ok, message: response.ok ? undefined : checkError(response) })
    } catch (error) {
      setConnection({ status: 'failed' })
      showError(error)
    } finally {
      setBusyAction(undefined)
    }
  }
  const save = async (localRuntime: LocalAgentConfiguration, savedName: string, action: 'save' | 'toggle') => {
    if (busy) return false
    setBusyAction(action)
    clearResult()
    try {
      if (!savedName) throw new Error(t('local_agents.name_required'))
      if (localRuntime.enabled || (!preset && !agent)) {
        const response = await ipcApi.request('ai.local_agents.check', localRuntime)
        if (!response.ok) {
          showError(checkError(response))
          return false
        }
      }
      const updated = await persistLocalRuntime(localRuntime, savedName)
      if (updated) {
        toast.success(t('common.saved'))
        await onSaved(updated.id)
      }
      return !!updated
    } catch (error) {
      showError(error)
      return false
    } finally {
      setBusyAction(undefined)
    }
  }
  const feedbackMessage = result.message ?? modelsError
  const classifiedError = feedbackMessage ? classifyLocalAgentError(feedbackMessage) : undefined
  const feedback = feedbackMessage && (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 text-xs',
        result.ok
          ? 'border-success-border bg-success-subtle text-success-subtle-foreground'
          : 'border-error-border bg-error-subtle text-error-subtle-foreground'
      )}>
      {result.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <CircleAlert className="size-4 shrink-0" />}
      <p className="min-w-0 whitespace-pre-wrap break-words">
        {classifiedError?.kind === 'authentication'
          ? t('local_agents.sign_in_required')
          : classifiedError?.kind === 'region'
            ? t('local_agents.auth_region_unavailable')
            : classifiedError?.message}
      </p>
    </div>
  )
  return (
    <>
      <header className={cn('shrink-0 px-6 pt-2.5 pb-4', modelSavingClass)}>
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
          {busyAction === 'toggle' && <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />}
          <Switch
            aria-label={t('local_agents.enable')}
            checked={initial.enabled}
            disabled={busy || (!preset && !agent)}
            onCheckedChange={(enabled) =>
              void save({ ...initial, enabled }, agent?.name ?? preset?.name ?? '', 'toggle')
            }
          />
        </div>
      </header>
      <Scrollbar className={cn('min-h-0 flex-1 overflow-x-hidden px-6 pb-6', modelSavingClass)}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <section className="space-y-3">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="text-sm leading-[1.3] font-medium">{t('local_agents.installation_location')}</h2>
              {preset && (
                <a
                  className="inline-flex shrink-0 items-center text-xs leading-[1.3] text-link transition-colors hover:underline"
                  href={preset.helpUrl}
                  target="_blank"
                  rel="noreferrer">
                  {t('local_agents.login_help')}
                </a>
              )}
            </div>
            <div className="flex items-start justify-end gap-2">
              {(initial.executableOverride ?? detection?.path ?? preset?.executable) && (
                <InputGroup
                  aria-label={t('local_agents.installation_location')}
                  onMouseEnter={() => setProgramHovered(true)}
                  onMouseLeave={() => setProgramHovered(false)}
                  className={cn(
                    'h-8 min-w-0 flex-1 rounded-lg border-border-subtle bg-muted/30 shadow-none transition-colors motion-reduce:transition-none',
                    connection?.status === 'ready' && 'border-success-border bg-success-subtle',
                    connection?.status === 'authentication-required' && 'border-warning-border bg-warning-subtle',
                    connection &&
                      !['ready', 'authentication-required'].includes(connection.status) &&
                      'border-error-border bg-error-subtle'
                  )}>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={openEditor}
                    aria-label={t('local_agents.installation_location')}
                    className="h-full min-w-0 flex-1 justify-start rounded-lg px-2.5 text-left font-normal hover:bg-transparent">
                    <span dir="rtl" className="min-w-0 truncate text-left font-mono text-xs text-foreground">
                      <bdi dir="ltr">{initial.executableOverride ?? detection?.path ?? preset?.executable}</bdi>
                    </span>
                  </Button>
                  <InputGroupAddon align="inline-end" className="shrink-0 gap-1 py-0 pr-1">
                    <span
                      role="status"
                      aria-live="polite"
                      className="flex items-center gap-1 whitespace-nowrap text-[11px]">
                      {connection ? (
                        <span
                          className={cn(
                            'flex items-center gap-1',
                            connection.status === 'ready'
                              ? 'text-success-subtle-foreground'
                              : connection.status === 'authentication-required'
                                ? 'text-warning-subtle-foreground'
                                : 'text-error-subtle-foreground'
                          )}>
                          {connection.status === 'ready' ? (
                            <CheckCircle2 className="lucide-custom size-3" />
                          ) : (
                            <CircleAlert className="lucide-custom size-3" />
                          )}
                          {connection.status === 'ready'
                            ? t('agent.channels.connected')
                            : connection.status === 'authentication-required'
                              ? t('local_agents.login_required')
                              : t('local_agents.check_failed')}
                          {connection.status === 'ready' &&
                            connection.version &&
                            ` · ${/^v/i.test(connection.version) ? connection.version : `v${connection.version}`}`}
                        </span>
                      ) : (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[11px] leading-4 text-muted-foreground">
                          {initial.executableOverride
                            ? t('settings.provider.not_checked')
                            : detection?.path
                              ? t('local_agents.detected')
                              : t('local_agents.not_installed')}
                        </Badge>
                      )}
                    </span>
                    {available && (
                      <Tooltip content={t('local_agents.check')}>
                        <InputGroupButton
                          size="icon-xs"
                          aria-label={t('local_agents.check')}
                          disabled={busy || (!preset && !agent)}
                          onClick={() => void check()}>
                          {busyAction === 'check' ? (
                            <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
                          ) : (
                            <PlugZap className="lucide-custom size-3.5 text-muted-foreground" />
                          )}
                        </InputGroupButton>
                      </Tooltip>
                    )}
                  </InputGroupAddon>
                </InputGroup>
              )}
              {available ? (
                <>
                  {preset?.terminalArgs && (
                    <Tooltip content={t('local_agents.open_terminal')}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 rounded-lg border-border-subtle text-xs shadow-none"
                        aria-label={t('local_agents.open_terminal')}
                        disabled={busy}
                        onClick={() => void openTerminal()}>
                        {busyAction === 'terminal' ? (
                          <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <SquareTerminal className="lucide-custom size-3.5 text-muted-foreground" />
                        )}
                        {t('code.terminal')}
                      </Button>
                    </Tooltip>
                  )}
                  {initial.protocol === 'acp' && (
                    <LocalAgentLogin
                      config={initial}
                      authMethods={catalog?.authMethods}
                      modelsLoading={modelsLoading}
                      available={!!(detection?.path || initial.executableOverride)}
                      disabled={busy || (!detection?.path && !initial.executableOverride)}
                      helpUrl={preset?.helpUrl}
                      onAuthenticated={async (localRuntime) => {
                        setConnection(undefined)
                        const updated = await persistLocalRuntime(localRuntime)
                        if (!updated) throw new Error(t('common.error'))
                        try {
                          const response = await ipcApi.request('ai.local_agents.check', localRuntime)
                          setResult({
                            ok: response.ok,
                            message: response.ok ? t('local_agents.connected') : checkError(response)
                          })
                          if (JSON.stringify(localRuntime.env) === JSON.stringify(initial.env)) await refreshModels()
                        } catch (error) {
                          toast.error(String(error))
                        } finally {
                          await onSaved(updated.id)
                        }
                      }}
                    />
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 rounded-lg border-border-subtle text-xs shadow-none"
                    disabled={busy || !agent || !initial.enabled}
                    onClick={() => void goToChat()}>
                    <MessageSquare className="lucide-custom size-3.5 text-muted-foreground" />
                    {t('title.chat')}
                  </Button>
                </>
              ) : preset ? (
                <Button
                  size="sm"
                  className="h-8 shrink-0 rounded-lg border border-transparent text-xs shadow-none"
                  disabled={busy}
                  onClick={() => void install()}>
                  {busyAction === 'install' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  {t(busyAction === 'install' ? 'local_agents.installing' : 'code.install')}
                </Button>
              ) : !agent ? (
                <Button size="sm" onClick={openEditor}>
                  {t('common.settings')}
                </Button>
              ) : null}
            </div>
            {(preset || agent) && (
              <LocalAgentModelList
                models={catalog?.models ?? []}
                groupFallback={agent?.name ?? preset?.name}
                value={initial.nativeModel}
                disabled={busy}
                loading={modelsLoading}
                loaded={!!catalog}
                loadDisabled={!detection?.path && !initial.executableOverride}
                onLoad={loadModels}
                onSelect={selectModel}
              />
            )}
            {(preset || agent) && (
              <p className="text-xs leading-relaxed text-muted-foreground">{t('local_agents.model_hint')}</p>
            )}
            {!editing && feedback}
          </section>
        </div>
      </Scrollbar>
      {editing && (
        <LocalAgentAdvancedSettings
          config={initial}
          name={agent?.name ?? preset?.name ?? ''}
          preset={preset}
          detection={detection}
          hasAgent={!!agent}
          busyAction={busyAction}
          pendingSelection={pendingSelection}
          feedback={feedback}
          onClose={closeEditor}
          onCancelNavigation={onCancelNavigation}
          onChange={clearResult}
          onError={showError}
          onUninstall={uninstall}
          onSave={(localRuntime, name) => save(localRuntime, name, 'save')}
        />
      )}
    </>
  )
}
