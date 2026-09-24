import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingSubtitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import {
  integrationConfigSchema,
  type IntegrationAction,
  type IntegrationConfig,
  type IntegrationSecret,
  type IntegrationSnapshot
} from '@shared/types/prometheusIntegration'

import { IntegrationChoice, IntegrationField, IntegrationToggle } from './IntegrationFields'
import { IntegrationOperations } from './IntegrationOperations'
import { UarIntegrationStatus } from './UarIntegrationStatus'

export function IntegrationSettings() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot | null>(null)
  const [draft, setDraft] = useState<IntegrationConfig>(() => integrationConfigSchema.parse({}))
  const [secrets, setSecrets] = useState<Partial<Record<IntegrationSecret, string>>>({})
  const [workspace, setWorkspace] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const text = (key: string) => t(`settings.prometheus.integration.${key}`)
  const dirty =
    snapshot !== null && (JSON.stringify(draft) !== JSON.stringify(snapshot.config) || Object.keys(secrets).length > 0)
  const running = snapshot?.operations.some((operation) => operation.status === 'running') ?? false
  const busy = saving || starting || running
  const load = useCallback(async () => {
    try {
      const value = await ipcApi.request('prometheus.integration.snapshot', {})
      setSnapshot(value)
      setDraft(value.config)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!running) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await ipcApi.request('prometheus.integration.snapshot', {})
        if (!disposed) setSnapshot(next)
      } catch (cause) {
        if (!disposed) setError(String(cause))
      }
      if (!disposed) timer = setTimeout(poll, 1000)
    }
    timer = setTimeout(poll, 500)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [running])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await ipcApi.request('prometheus.integration.configure', { config: draft, secrets })
      setSnapshot(next)
      setDraft(next.config)
      setSecrets({})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }
  const start = async (action: IntegrationAction) => {
    setStarting(true)
    setError(null)
    try {
      const operation = await ipcApi.request('prometheus.integration.start', {
        action,
        workspacePath: workspace || undefined
      })
      setSnapshot((current) =>
        current ? { ...current, operations: [operation, ...current.operations].slice(0, 20) } : current
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStarting(false)
    }
  }
  const cancel = async (id: string) => {
    try {
      await ipcApi.request('prometheus.integration.cancel', { id })
    } catch (cause) {
      setError(String(cause))
    }
  }
  const update = <K extends keyof IntegrationConfig>(section: K, values: Partial<IntegrationConfig[K]>) =>
    setDraft((current) => ({ ...current, [section]: { ...current[section], ...values } }))
  const secretField = (key: IntegrationSecret) => (
    <IntegrationField
      label={text(`credentials.${key}`)}
      type="password"
      value={secrets[key] ?? ''}
      help={snapshot?.secrets[key] ? text('credentialSaved') : text('credentialEmpty')}
      onChange={(value) =>
        setSecrets((current) => {
          const next = { ...current }
          if (value) next[key] = value
          else delete next[key]
          return next
        })
      }
    />
  )
  const actionButton = (action: IntegrationAction, needsWorkspace = false) => (
    <Button
      key={action}
      variant="outline"
      size="sm"
      disabled={busy || dirty || (needsWorkspace && !workspace)}
      onClick={() => void start(action)}>
      {text(`actions.${action}`)}
    </Button>
  )

  if (!snapshot)
    return (
      <SettingGroup theme={theme}>
        <SettingSubtitle>{text('title')}</SettingSubtitle>
        <p role={error ? 'alert' : 'status'} className="text-sm">
          {error ? t(error, { defaultValue: error }) : t('common.loading')}
        </p>
        {error && (
          <Button variant="outline" onClick={() => void load()}>
            {text('actions.retry')}
          </Button>
        )}
      </SettingGroup>
    )

  return (
    <>
      <SettingGroup theme={theme}>
        <SettingSubtitle>{text('title')}</SettingSubtitle>
        <SettingDescription>{text('description')}</SettingDescription>
        <SettingDivider />
        <div className="space-y-5">
          <IntegrationToggle
            label={text('compassEnabled')}
            checked={draft.compass.enabled}
            onChange={(enabled) => update('compass', { enabled })}
          />
          <IntegrationChoice
            label={text('storage')}
            value={draft.compass.storage}
            onChange={(storage) => update('compass', { storage })}
            options={(['automatic', 'remote', 'sqlite', 'json'] as const).map((value) => ({
              value,
              label: text(`backends.${value}`)
            }))}
          />
          <SettingHelpText>{text('automaticHelp')}</SettingHelpText>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">{snapshot.pathInstalled ? text('pathReady') : text('pathMissing')}</p>
              <p className="mt-1 break-all text-xs text-foreground-secondary">{snapshot.commandDirectory}</p>
            </div>
            {actionButton('repair-path')}
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">{text('remoteConfiguration')}</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <IntegrationField
                label={text('endpoint')}
                value={draft.compass.endpoint}
                disabled={draft.services.mode === 'managed'}
                onChange={(endpoint) => update('compass', { endpoint })}
              />
              <IntegrationField
                label={text('namespace')}
                value={draft.compass.namespace}
                onChange={(namespace) => update('compass', { namespace })}
              />
              <IntegrationField
                label={text('username')}
                value={draft.compass.username}
                onChange={(username) => update('compass', { username })}
              />
              {secretField('compassPassword')}
              <IntegrationChoice
                label={text('authLevel')}
                value={draft.compass.authLevel}
                disabled={draft.services.mode === 'managed'}
                onChange={(authLevel) => update('compass', { authLevel })}
                options={(['root', 'namespace', 'database'] as const).map((value) => ({
                  value,
                  label: text(`auth.${value}`)
                }))}
              />
            </div>
          </details>
        </div>
        <SettingDivider />
        <SettingSubtitle>{text('filesystem')}</SettingSubtitle>
        <div className="mt-4 space-y-4">
          <IntegrationToggle
            label={text('filesystemEnabled')}
            checked={draft.filesystem.enabled}
            onChange={(enabled) => update('filesystem', { enabled })}
          />
          <IntegrationToggle
            label={text('allowWrite')}
            checked={draft.filesystem.allowWrite}
            onChange={(allowWrite) => update('filesystem', { allowWrite })}>
            <SettingHelpText className="mt-1">{text('rootsHelp')}</SettingHelpText>
          </IntegrationToggle>
          <IntegrationField
            label={text('additionalRoots')}
            value={draft.filesystem.additionalRoots.join(';')}
            help={text('rootsFormat')}
            onChange={(value) => update('filesystem', { additionalRoots: value.split(';') })}
          />
        </div>
      </SettingGroup>

      <UarIntegrationStatus
        snapshot={snapshot}
        busy={busy}
        dirty={dirty}
        theme={theme}
        text={text}
        start={(action) => void start(action)}
      />

      <SettingGroup theme={theme}>
        <SettingSubtitle>{text('services')}</SettingSubtitle>
        <SettingDescription>{text('servicesHelp')}</SettingDescription>
        <SettingDivider />
        <div className="space-y-5">
          <IntegrationChoice
            label={text('serviceMode')}
            value={draft.services.mode}
            onChange={(mode) => update('services', { mode })}
            options={(['managed', 'external'] as const).map((value) => ({ value, label: text(value) }))}
          />
          {draft.services.mode === 'managed' ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                {(['surrealPort', 'memoryPort', 'literPort'] as const).map((key) => (
                  <IntegrationField
                    key={key}
                    label={text(key)}
                    type="number"
                    value={String(draft.services[key])}
                    onChange={(value) => update('services', { [key]: Number(value) })}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {(['pull', 'start', 'stop', 'restart', 'status', 'logs'] as const).map((action) =>
                  actionButton(action)
                )}
              </div>
              <SettingHelpText className="break-all">
                {text('persistentStorage')}: {snapshot.serviceDirectory}
              </SettingHelpText>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <IntegrationField
                label={text('memoryEndpoint')}
                value={draft.services.memoryEndpoint}
                onChange={(memoryEndpoint) => update('services', { memoryEndpoint })}
              />
              <IntegrationField
                label={text('literEndpoint')}
                value={draft.services.literEndpoint}
                onChange={(literEndpoint) => update('services', { literEndpoint })}
              />
              <div>{actionButton('status')}</div>
            </div>
          )}
          <IntegrationToggle
            label={text('memoryEnabled')}
            checked={draft.services.memoryEnabled}
            onChange={(memoryEnabled) => update('services', { memoryEnabled })}
          />
          <details>
            <summary className="cursor-pointer text-sm font-medium">{text('credentialsTitle')}</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {secretField('memoryToken')}
              {secretField('literKey')}
            </div>
          </details>
          <details>
            <summary className="cursor-pointer text-sm font-medium">{text('modelMapping')}</summary>
            <div className="mt-4 space-y-5">
              {(['judge', 'critic'] as const).map((role) => (
                <fieldset key={role} className="space-y-3">
                  <legend className="mb-3 text-sm font-medium">{text(role)}</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <IntegrationField
                      label={text('providerModel')}
                      value={draft.services[role].name}
                      onChange={(name) => update('services', { [role]: { ...draft.services[role], name } })}
                    />
                    <IntegrationField
                      label={text('providerEndpoint')}
                      value={draft.services[role].baseUrl}
                      onChange={(baseUrl) => update('services', { [role]: { ...draft.services[role], baseUrl } })}
                    />
                    {secretField(role === 'judge' ? 'judgeKey' : 'criticKey')}
                  </div>
                </fieldset>
              ))}
            </div>
          </details>
        </div>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <SettingSubtitle>{text('workspace')}</SettingSubtitle>
        <SettingDescription>{text('workspaceHelp')}</SettingDescription>
        <SettingDivider />
        <div className="space-y-4">
          {snapshot.workspaces.length > 0 && (
            <IntegrationChoice
              label={text('knownWorkspaces')}
              value={workspace || '__choose__'}
              onChange={(value) => setWorkspace(value === '__choose__' ? '' : value)}
              options={[
                { value: '__choose__', label: text('chooseWorkspace') },
                ...snapshot.workspaces.map((entry) => ({ value: entry.path, label: entry.path }))
              ]}
            />
          )}
          <IntegrationField label={text('workspacePath')} value={workspace} onChange={setWorkspace} />
          <div className="flex flex-wrap gap-2">
            {(['index', 'refresh', 'install-skills', 'diagnose'] as const).map((action) => actionButton(action, true))}
          </div>
          <SettingHelpText>{text('diagnosticsHelp')}</SettingHelpText>
          {snapshot.workspaces
            .filter((entry) => entry.path === workspace)
            .map((entry) => (
              <div key={entry.id} className="space-y-1 text-sm">
                <p>
                  {text('effectiveBackend')}: {text(`backends.${entry.backend}`)}
                </p>
                <p>{entry.indexed ? text('indexed') : text('notIndexed')}</p>
                <p className="break-all text-xs text-foreground-secondary">{entry.graph}</p>
                {entry.error && (
                  <p className="text-error" role="alert">
                    {t(entry.error, { defaultValue: entry.error })}
                  </p>
                )}
              </div>
            ))}
          <ul className="divide-y divide-border">
            {snapshot.servers
              .filter((server) => !workspace || !server.workspace || server.workspace === workspace)
              .map((server) => (
                <li key={server.id} className="py-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <Link
                      to="/settings/mcp/settings/$serverId"
                      params={{ serverId: server.id }}
                      className="font-medium underline underline-offset-4 focus-visible:outline focus-visible:outline-2">
                      {server.name}
                    </Link>
                    <span className="text-foreground-secondary">
                      {t(`settings.mcp.runtimeStatus.${server.status}`)}
                    </span>
                  </div>
                  {server.binary && <p className="mt-1 break-all text-xs text-foreground-secondary">{server.binary}</p>}
                  <Link
                    to="/settings/mcp/settings/$serverId"
                    params={{ serverId: server.id }}
                    className="mt-1 inline-block text-xs underline underline-offset-4">
                    {t('settings.mcp.logs')}
                  </Link>
                </li>
              ))}
          </ul>
          {snapshot.inventory && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                {text('inventory')} · {snapshot.inventory.skills.length}
              </summary>
              <p className="mt-2 break-all text-xs">{snapshot.inventory.revision}</p>
              <ul className="mt-3 columns-2 space-y-1 text-sm">
                {snapshot.inventory.skills.map((skill) => (
                  <li key={skill} className="break-words">
                    {skill}
                  </li>
                ))}
              </ul>
              <dl className="mt-3 text-sm">
                {Object.entries(snapshot.inventory.tools).map(([tool, version]) => (
                  <div key={tool} className="flex flex-wrap justify-between gap-2">
                    <dt>{tool}</dt>
                    <dd>{version}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
        <IntegrationOperations operations={snapshot.operations} cancel={(id) => void cancel(id)} />
      </SettingGroup>
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-1 py-3">
        <div className="min-w-0 flex-1 text-sm" role={error ? 'alert' : 'status'}>
          {error ? (
            <span className="break-words text-error">{t(error, { defaultValue: error })}</span>
          ) : dirty ? (
            text('unsaved')
          ) : (
            text('saved')
          )}
        </div>
        <Button disabled={!dirty || busy} onClick={() => void save()}>
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </>
  )
}
