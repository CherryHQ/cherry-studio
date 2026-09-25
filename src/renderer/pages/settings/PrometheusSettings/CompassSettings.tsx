import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { OperationLogViewer } from '@renderer/components/operation'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingSubtitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useIntegrationOperation } from '@renderer/hooks/useIntegrationOperation'
import { useTheme } from '@renderer/hooks/useTheme'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'
import type { IntegrationOperation, IntegrationOperationLogPage } from '@shared/types/prometheusIntegration'

import { IntegrationChoice, IntegrationField, IntegrationToggle } from './IntegrationFields'
import { IntegrationActionButton, IntegrationPage, IntegrationSecretField, integrationText } from './IntegrationPage'

const LOG_PAGE_SIZE = 64 * 1024

function WorkspaceOperationLog({ operation }: { operation?: IntegrationOperation }) {
  const { t } = useTranslation()
  const [page, setPage] = useState<IntegrationOperationLogPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { readLog, exportLog } = useIntegrationOperation(operation?.id, operation)

  const loadPage = useCallback(
    async (offset = 0) => {
      if (!operation?.id) return
      setLoading(true)
      try {
        setPage(await readLog(offset, LOG_PAGE_SIZE))
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setLoading(false)
      }
    },
    [operation?.id, readLog]
  )

  useEffect(() => {
    setPage(null)
    if (operation) void loadPage()
  }, [loadPage, operation?.id])

  if (!operation) return null
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      {error && (
        <p className="text-error text-sm" role="alert">
          {t(error, { defaultValue: error })}
        </p>
      )}
      <OperationLogViewer
        page={page}
        loading={loading}
        title={integrationText(t, 'operation.fullLog')}
        positionLabel={
          page
            ? t('settings.prometheus.integration.operation.logPosition', {
                start: page.offset,
                end: page.nextOffset,
                total: page.totalBytes
              })
            : ''
        }
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          copy: t('common.copy'),
          save: t('common.save'),
          empty: integrationText(t, 'operation.emptyLog')
        }}
        onPrevious={() => void loadPage(Math.max(0, (page?.offset ?? 0) - LOG_PAGE_SIZE))}
        onNext={() => void loadPage(page?.nextOffset ?? 0)}
        onSave={() => void exportLog().catch((cause) => setError(String(cause)))}
      />
    </div>
  )
}

export default function CompassSettings() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  return (
    <IntegrationPage>
      {(controller) => {
        const snapshot = controller.snapshot!
        const selectedWorkspace = snapshot.workspaces.find((entry) => entry.path === controller.workspace)
        const workspaceOperation = selectedWorkspace
          ? (snapshot.operations.find((operation) => operation.id === selectedWorkspace.latestOperationId) ??
            snapshot.operations.find((operation) => operation.workspacePath === selectedWorkspace.path))
          : undefined
        const runtimeStatus = {
          connected: t('settings.mcp.runtimeStatus.connected'),
          connecting: t('settings.mcp.runtimeStatus.connecting'),
          disabled: t('settings.mcp.runtimeStatus.disabled'),
          error: t('settings.mcp.runtimeStatus.error'),
          unavailable: t('settings.mcp.runtimeStatus.unavailable')
        }
        return (
          <>
            <SettingGroup
              theme={theme}
              id={getSettingDomId('/settings/compass', 'graph-storage')}
              className="scroll-mt-6">
              <SettingTitle>{integrationText(t, 'compassTitle')}</SettingTitle>
              <SettingDescription>{integrationText(t, 'description')}</SettingDescription>
              <SettingDivider />
              <div className="space-y-5">
                <IntegrationToggle
                  label={integrationText(t, 'compassEnabled')}
                  checked={controller.draft.compass.enabled}
                  onChange={(enabled) => controller.update('compass', { enabled })}
                />
                <IntegrationChoice
                  label={integrationText(t, 'storage')}
                  value={controller.draft.compass.storage}
                  onChange={(storage) => controller.update('compass', { storage })}
                  options={(['automatic', 'remote', 'sqlite', 'json'] as const).map((value) => ({
                    value,
                    label: integrationText(t, `backends.${value}`)
                  }))}
                />
                <SettingHelpText>{integrationText(t, 'automaticHelp')}</SettingHelpText>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">
                      {integrationText(t, snapshot.pathInstalled ? 'pathReady' : 'pathMissing')}
                    </p>
                    <p className="mt-1 break-all text-xs text-foreground-secondary">{snapshot.commandDirectory}</p>
                  </div>
                  <IntegrationActionButton controller={controller} action="repair-path" />
                </div>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    {integrationText(t, 'remoteConfiguration')}
                  </summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <IntegrationField
                      label={integrationText(t, 'endpoint')}
                      value={controller.draft.services.surrealdb.endpoint}
                      disabled={controller.draft.services.surrealdb.ownership === 'managed'}
                      onChange={(endpoint) =>
                        controller.update('services', {
                          surrealdb: { ...controller.draft.services.surrealdb, endpoint, source: 'manual' }
                        })
                      }
                    />
                    <IntegrationField
                      label={integrationText(t, 'namespace')}
                      value={controller.draft.compass.namespace}
                      onChange={(namespace) => controller.update('compass', { namespace })}
                    />
                    <IntegrationField
                      label={integrationText(t, 'username')}
                      value={controller.draft.compass.username}
                      onChange={(username) => controller.update('compass', { username })}
                    />
                    <IntegrationSecretField controller={controller} secret="compassPassword" />
                    <IntegrationChoice
                      label={integrationText(t, 'authLevel')}
                      value={controller.draft.compass.authLevel}
                      disabled={controller.draft.services.surrealdb.ownership === 'managed'}
                      onChange={(authLevel) => controller.update('compass', { authLevel })}
                      options={(['root', 'namespace', 'database'] as const).map((value) => ({
                        value,
                        label: integrationText(t, `auth.${value}`)
                      }))}
                    />
                  </div>
                </details>
              </div>
              <SettingDivider />
              <div id={getSettingDomId('/settings/compass', 'filesystem-mcp')} className="scroll-mt-6">
                <SettingSubtitle>{integrationText(t, 'filesystem')}</SettingSubtitle>
                <div className="mt-4 space-y-4">
                  <IntegrationToggle
                    label={integrationText(t, 'filesystemEnabled')}
                    checked={controller.draft.filesystem.enabled}
                    onChange={(enabled) => controller.update('filesystem', { enabled })}
                  />
                  <IntegrationToggle
                    label={integrationText(t, 'allowWrite')}
                    checked={controller.draft.filesystem.allowWrite}
                    onChange={(allowWrite) => controller.update('filesystem', { allowWrite })}>
                    <SettingHelpText className="mt-1">{integrationText(t, 'rootsHelp')}</SettingHelpText>
                  </IntegrationToggle>
                  <IntegrationField
                    label={integrationText(t, 'additionalRoots')}
                    value={controller.draft.filesystem.additionalRoots.join(';')}
                    help={integrationText(t, 'rootsFormat')}
                    onChange={(value) => controller.update('filesystem', { additionalRoots: value.split(';') })}
                  />
                </div>
              </div>
            </SettingGroup>

            <SettingGroup
              theme={theme}
              id={getSettingDomId('/settings/compass', 'workspace-index')}
              className="scroll-mt-6">
              <SettingSubtitle>{integrationText(t, 'workspace')}</SettingSubtitle>
              <SettingDescription>{integrationText(t, 'workspaceHelp')}</SettingDescription>
              <SettingDivider />
              <div className="space-y-4">
                {snapshot.workspaces.length > 0 && (
                  <IntegrationChoice
                    label={integrationText(t, 'knownWorkspaces')}
                    value={controller.workspace || '__choose__'}
                    onChange={(value) => controller.setWorkspace(value === '__choose__' ? '' : value)}
                    options={[
                      { value: '__choose__', label: integrationText(t, 'chooseWorkspace') },
                      ...snapshot.workspaces.map((entry) => ({ value: entry.path, label: entry.path }))
                    ]}
                  />
                )}
                <IntegrationField
                  label={integrationText(t, 'workspacePath')}
                  value={controller.workspace}
                  onChange={controller.setWorkspace}
                />
                <div className="flex flex-wrap gap-2">
                  {(['check-drift', 'index', 'refresh', 'install-skills', 'diagnose'] as const).map((action) => (
                    <IntegrationActionButton key={action} controller={controller} action={action} workspaceRequired />
                  ))}
                </div>
                <SettingHelpText>{integrationText(t, 'diagnosticsHelp')}</SettingHelpText>
                {selectedWorkspace && (
                  <div className="space-y-3">
                    <div className="space-y-2 rounded-md border border-border p-3 text-sm">
                      <IntegrationToggle
                        label={integrationText(t, 'workspaceCompassEnabled')}
                        checked={selectedWorkspace.enabled}
                        onChange={(enabled) => void controller.setWorkspaceEnabled(selectedWorkspace.path, enabled)}
                      />
                      <p>
                        {integrationText(t, 'effectiveBackend')}:{' '}
                        {integrationText(t, `backends.${selectedWorkspace.backend}`)}
                      </p>
                      <p aria-live="polite">
                        {integrationText(t, 'freshnessLabel')}:{' '}
                        {integrationText(t, `freshness.${selectedWorkspace.freshness.state}`)}
                      </p>
                      {selectedWorkspace.freshness.detail && (
                        <p className="break-words text-xs text-foreground-secondary">
                          {t(selectedWorkspace.freshness.detail, { defaultValue: selectedWorkspace.freshness.detail })}
                        </p>
                      )}
                      <p>{integrationText(t, selectedWorkspace.indexed ? 'indexed' : 'notIndexed')}</p>
                      <p className="break-all text-xs text-foreground-secondary">{selectedWorkspace.graph}</p>
                      {selectedWorkspace.error && (
                        <p className="text-error" role="alert">
                          {t(selectedWorkspace.error, { defaultValue: selectedWorkspace.error })}
                        </p>
                      )}
                    </div>
                    <WorkspaceOperationLog operation={workspaceOperation} />
                  </div>
                )}
                <ul className="divide-y divide-border">
                  {snapshot.servers
                    .filter(
                      (server) =>
                        !controller.workspace || !server.workspace || server.workspace === controller.workspace
                    )
                    .map((server) => (
                      <li key={server.id} className="py-3 text-sm">
                        <div className="flex flex-wrap justify-between gap-2">
                          <Link
                            to="/settings/mcp/settings/$serverId"
                            params={{ serverId: server.id }}
                            className="font-medium underline underline-offset-4 focus-visible:outline focus-visible:outline-2">
                            {server.name}
                          </Link>
                          <span className="text-foreground-secondary">{runtimeStatus[server.status]}</span>
                        </div>
                        {server.binary && (
                          <p className="mt-1 break-all text-xs text-foreground-secondary">{server.binary}</p>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            </SettingGroup>
          </>
        )
      }}
    </IntegrationPage>
  )
}
