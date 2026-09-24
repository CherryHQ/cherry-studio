import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingSubtitle,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'

import { IntegrationChoice, IntegrationField, IntegrationToggle } from './IntegrationFields'
import { IntegrationActionButton, IntegrationPage, IntegrationSecretField, integrationText } from './IntegrationPage'

export default function CompassSettings() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  return (
    <IntegrationPage>
      {(controller) => {
        const snapshot = controller.snapshot!
        const selectedWorkspace = snapshot.workspaces.find((entry) => entry.path === controller.workspace)
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
                  {(['index', 'refresh', 'install-skills', 'diagnose'] as const).map((action) => (
                    <IntegrationActionButton key={action} controller={controller} action={action} workspaceRequired />
                  ))}
                </div>
                <SettingHelpText>{integrationText(t, 'diagnosticsHelp')}</SettingHelpText>
                {selectedWorkspace && (
                  <div className="space-y-1 rounded-md border border-border p-3 text-sm">
                    <p>
                      {integrationText(t, 'effectiveBackend')}:{' '}
                      {integrationText(t, `backends.${selectedWorkspace.backend}`)}
                    </p>
                    <p>{integrationText(t, selectedWorkspace.indexed ? 'indexed' : 'notIndexed')}</p>
                    <p className="break-all text-xs text-foreground-secondary">{selectedWorkspace.graph}</p>
                    {selectedWorkspace.error && (
                      <p className="text-error" role="alert">
                        {t(selectedWorkspace.error, { defaultValue: selectedWorkspace.error })}
                      </p>
                    )}
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
