import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button } from '@cherrystudio/ui'
import { OperationProgress } from '@renderer/components/operation'
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
import type {
  IntegrationAction,
  IntegrationOperation,
  IntegrationOperationStage,
  IntegrationOperationStatus
} from '@shared/types/prometheusIntegration'

import { IntegrationChoice, IntegrationField, IntegrationToggle } from './IntegrationFields'
import { IntegrationActionButton, IntegrationPage, IntegrationSecretField, integrationText } from './IntegrationPage'
import type { IntegrationSettingsController } from './useIntegrationSettings'

const services = ['surrealdb', 'memory', 'liter'] as const
const serviceActions: IntegrationAction[] = ['discover-services', 'pull', 'start', 'stop', 'restart', 'status', 'logs']

const statusKey: Record<IntegrationOperationStatus, string> = {
  queued: 'running',
  running: 'running',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'failed'
}

const stageKey: Record<IntegrationOperationStage, string> = {
  queued: 'operationInProgress',
  detecting: 'actions.status',
  preparing: 'operationInProgress',
  pulling: 'actions.pull',
  starting: 'actions.start',
  authenticating: 'states.authenticated',
  running: 'states.running',
  stopping: 'actions.stop',
  restarting: 'actions.restart',
  checking: 'actions.status',
  indexing: 'operationInProgress',
  publishing: 'operationInProgress',
  refreshing: 'operationInProgress',
  finalizing: 'operationInProgress',
  completed: 'states.done'
}

function elapsedKey(milliseconds: number): { key: string; values: Record<string, number> } {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days)
    return {
      key: 'message.tools.placeholder.elapsed.days',
      values: { days, hours: hours % 24, minutes: minutes % 60, seconds: seconds % 60 }
    }
  if (hours)
    return {
      key: 'message.tools.placeholder.elapsed.hours',
      values: { hours, minutes: minutes % 60, seconds: seconds % 60 }
    }
  if (minutes) return { key: 'message.tools.placeholder.elapsed.minutes', values: { minutes, seconds: seconds % 60 } }
  return { key: 'message.tools.placeholder.elapsed.seconds', values: { seconds } }
}

function ServicesOperationStatus({
  controller,
  initialOperation
}: {
  controller: IntegrationSettingsController
  initialOperation: IntegrationOperation
}) {
  const { t } = useTranslation()
  const { operation, error, cancel } = useIntegrationOperation(initialOperation.id, initialOperation)
  const active = operation?.status === 'queued' || operation?.status === 'running'
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])

  if (!operation) return null
  const elapsed = elapsedKey((operation.completedAt ?? now) - operation.startedAt)
  return (
    <div className="space-y-3">
      <OperationProgress
        operation={operation}
        title={integrationText(t, `actions.${operation.action}`)}
        statusLabel={integrationText(t, `states.${statusKey[operation.status]}`)}
        stageLabel={integrationText(t, stageKey[operation.stage])}
        progressLabel={integrationText(t, 'operationInProgress')}
        progressText={operation.progress ? `${operation.progress.current}/${operation.progress.total}` : undefined}
        elapsedLabel={t(elapsed.key, elapsed.values)}
        errorText={operation.error ? t(operation.error, { defaultValue: operation.error }) : error}
        resultText={operation.status === 'succeeded' ? integrationText(t, 'states.done') : undefined}
        recoveryText={operation.recoveryAction ? integrationText(t, 'actions.retry') : undefined}
        labels={{
          cancel: t('common.cancel'),
          retry: integrationText(t, 'actions.retry'),
          viewLog: integrationText(t, 'output'),
          tail: integrationText(t, 'liveOutput')
        }}
        onCancel={active ? () => void cancel() : undefined}
        onRetry={
          operation.status === 'failed' || operation.status === 'interrupted'
            ? () => void controller.start(operation.action, operation.workspacePath)
            : undefined
        }
      />
      {operation.diagnostics?.length ? (
        <dl className="grid gap-2 sm:grid-cols-2" aria-live="polite">
          {operation.diagnostics.map((diagnostic) => (
            <div key={diagnostic.id} className="flex min-w-0 items-start justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <dt className="break-words text-sm font-medium">{diagnostic.id}</dt>
                {diagnostic.detail && (
                  <dd className="break-words text-xs text-foreground-secondary">{diagnostic.detail}</dd>
                )}
              </div>
              <Badge variant="outline">{integrationText(t, `states.${diagnostic.state}`)}</Badge>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

export default function ServicesSettings() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  return (
    <IntegrationPage>
      {(controller) => {
        const snapshot = controller.snapshot!
        const latestServiceOperation = snapshot.operations.find((operation) =>
          serviceActions.includes(operation.action)
        )
        const hasManagedService = services.some((service) => controller.draft.services[service].ownership === 'managed')
        return (
          <>
            <SettingGroup
              theme={theme}
              id={getSettingDomId('/settings/services', 'service-management')}
              className="scroll-mt-6">
              <SettingTitle>{integrationText(t, 'services')}</SettingTitle>
              <SettingDescription>{integrationText(t, 'servicesHelp')}</SettingDescription>
              <SettingDivider />
              <div className="space-y-5">
                {services.map((service) => {
                  const profile = controller.draft.services[service]
                  const endpointLabel =
                    service === 'memory' ? 'memoryEndpoint' : service === 'liter' ? 'literEndpoint' : 'endpoint'
                  return (
                    <fieldset key={service} className="space-y-4 rounded-md border border-border p-4">
                      <legend className="px-1 text-sm font-medium">{integrationText(t, `service.${service}`)}</legend>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <IntegrationChoice
                          label={integrationText(t, 'serviceMode')}
                          value={profile.ownership}
                          onChange={(ownership) =>
                            controller.update('services', {
                              [service]: {
                                ...profile,
                                ownership,
                                source: ownership === 'managed' ? 'application' : 'manual'
                              }
                            })
                          }
                          options={(['managed', 'external'] as const).map((value) => ({
                            value,
                            label: integrationText(t, value)
                          }))}
                        />
                        {profile.ownership === 'external' && (
                          <IntegrationField
                            label={integrationText(t, endpointLabel)}
                            value={profile.endpoint}
                            onChange={(endpoint) =>
                              controller.update('services', {
                                [service]: { ...profile, endpoint, source: 'manual' }
                              })
                            }
                          />
                        )}
                      </div>
                      {profile.ownership === 'managed' && (
                        <SettingHelpText className="break-all">{profile.endpoint}</SettingHelpText>
                      )}
                    </fieldset>
                  )
                })}
                <div className="grid gap-4 sm:grid-cols-3">
                  {(['surrealPort', 'memoryPort', 'literPort'] as const).map((key) => (
                    <IntegrationField
                      key={key}
                      label={integrationText(t, key)}
                      type="number"
                      value={String(controller.draft.services[key])}
                      disabled={
                        controller.draft.services[
                          key === 'surrealPort' ? 'surrealdb' : key === 'memoryPort' ? 'memory' : 'liter'
                        ].ownership === 'external'
                      }
                      onChange={(value) => controller.update('services', { [key]: Number(value) })}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <IntegrationActionButton controller={controller} action="discover-services" />
                  {hasManagedService &&
                    (['pull', 'start', 'stop', 'restart'] as const).map((action) => (
                      <IntegrationActionButton key={action} controller={controller} action={action} />
                    ))}
                  <IntegrationActionButton controller={controller} action="status" />
                  {hasManagedService && <IntegrationActionButton controller={controller} action="logs" />}
                </div>
                {latestServiceOperation && (
                  <ServicesOperationStatus controller={controller} initialOperation={latestServiceOperation} />
                )}
                <SettingHelpText className="break-all">
                  {integrationText(t, 'persistentStorage')}: {snapshot.serviceDirectory}
                </SettingHelpText>
                <IntegrationToggle
                  label={integrationText(t, 'memoryEnabled')}
                  checked={controller.draft.services.memoryEnabled}
                  onChange={(memoryEnabled) => controller.update('services', { memoryEnabled })}
                />
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    {integrationText(t, 'credentialsTitle')}
                  </summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <IntegrationSecretField controller={controller} secret="rootPassword" />
                    <IntegrationSecretField controller={controller} secret="memoryPassword" />
                    <IntegrationSecretField controller={controller} secret="memoryToken" />
                    <IntegrationSecretField controller={controller} secret="literKey" />
                  </div>
                </details>
              </div>
            </SettingGroup>

            <SettingGroup
              theme={theme}
              id={getSettingDomId('/settings/services', 'service-discovery')}
              className="scroll-mt-6">
              <SettingSubtitle>{integrationText(t, 'discoveredServices')}</SettingSubtitle>
              <SettingDescription>{integrationText(t, 'discoveredServicesHelp')}</SettingDescription>
              <SettingDivider />
              {snapshot.serviceDiscovery.candidates.length ? (
                <div className="divide-y divide-border">
                  {snapshot.serviceDiscovery.candidates.map((candidate) => {
                    const provenance = candidate.provenance[0]
                    return (
                      <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0 text-sm">
                          <p className="font-medium">
                            {provenance?.label ?? integrationText(t, `service.${candidate.service}`)}
                          </p>
                          <p className="break-all text-xs text-foreground-secondary">{candidate.endpoint}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={controller.busy}
                          onClick={() =>
                            controller.update('services', {
                              [candidate.service]: {
                                ownership: 'external',
                                source: provenance?.source ?? 'manual',
                                endpoint: candidate.endpoint
                              }
                            })
                          }>
                          {integrationText(t, 'useDiscoveredService')}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <SettingHelpText>{integrationText(t, 'noDiscoveredServices')}</SettingHelpText>
              )}
              {snapshot.serviceDiscovery.errors.map((message) => (
                <p key={message} role="alert" className="mt-2 break-words text-sm text-error">
                  {t(message, { defaultValue: message })}
                </p>
              ))}
            </SettingGroup>
          </>
        )
      }}
    </IntegrationPage>
  )
}
