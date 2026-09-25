import type { TFunction } from 'i18next'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { SettingGroup, SettingsContentColumn, SettingSubtitle } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import type { IntegrationAction, IntegrationSecret } from '@shared/types/prometheusIntegration'

import { IntegrationField } from './IntegrationFields'
import { IntegrationOperations } from './IntegrationOperations'
import type { IntegrationSettingsController } from './useIntegrationSettings'
import { useIntegrationSettings } from './useIntegrationSettings'

export const integrationText = (translate: TFunction, key: string) =>
  translate(`settings.prometheus.integration.${key}`)

export function IntegrationActionButton({
  controller,
  action,
  workspaceRequired = false
}: {
  controller: IntegrationSettingsController
  action: IntegrationAction
  workspaceRequired?: boolean
}) {
  const { t } = useTranslation()
  const active = controller.startingAction === action || controller.activeOperation?.action === action
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={controller.busy || controller.dirty || (workspaceRequired && !controller.workspace)}
      onClick={() => void controller.start(action)}>
      {active && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
      {integrationText(t, `actions.${action}`)}
    </Button>
  )
}

export function IntegrationSecretField({
  controller,
  secret,
  labelKey
}: {
  controller: IntegrationSettingsController
  secret: IntegrationSecret
  labelKey?: string
}) {
  const { t } = useTranslation()
  return (
    <IntegrationField
      label={integrationText(t, labelKey ?? `credentials.${secret}`)}
      type="password"
      value={controller.secrets[secret] ?? ''}
      help={
        controller.snapshot?.secrets[secret]
          ? integrationText(t, 'credentialSaved')
          : integrationText(t, 'credentialEmpty')
      }
      onChange={(value) => controller.setSecret(secret, value)}
    />
  )
}

function IntegrationSaveBar({ controller }: { controller: IntegrationSettingsController }) {
  const { t } = useTranslation()
  const latest = controller.snapshot?.operations[0]
  const latestFailed = latest?.status === 'failed' || latest?.status === 'interrupted'
  const latestState =
    latest?.status === 'queued' || latest?.status === 'running'
      ? 'running'
      : latest?.status === 'succeeded'
        ? 'done'
        : latest?.status
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-1 py-3">
      <div className="min-w-0 flex-1 text-sm" role={controller.error ? 'alert' : 'status'} aria-live="polite">
        {controller.error ? (
          <span className="break-words text-error">{t(controller.error, { defaultValue: controller.error })}</span>
        ) : controller.activeOperation ? (
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />
            {integrationText(t, `actions.${controller.activeOperation.action}`)} ·{' '}
            {integrationText(t, 'operationInProgress')}
          </span>
        ) : controller.dirty ? (
          integrationText(t, 'unsaved')
        ) : latest ? (
          <span className={latestFailed ? 'flex items-center gap-2 text-error' : 'flex items-center gap-2'}>
            {latestFailed ? <XCircle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            {integrationText(t, `actions.${latest.action}`)} · {integrationText(t, `states.${latestState}`)}
            {latest.error ? ` — ${t(latest.error, { defaultValue: latest.error })}` : ''}
          </span>
        ) : (
          integrationText(t, 'saved')
        )}
      </div>
      <Button disabled={!controller.dirty || controller.busy} onClick={() => void controller.save()}>
        {controller.saving ? t('common.loading') : t('common.save')}
      </Button>
    </div>
  )
}

export function IntegrationPage({ children }: { children: (controller: IntegrationSettingsController) => ReactNode }) {
  const controller = useIntegrationSettings()
  const { t } = useTranslation()
  const { theme } = useTheme()

  if (!controller.snapshot) {
    return (
      <SettingsContentColumn theme={theme}>
        <SettingGroup theme={theme}>
          <SettingSubtitle>{integrationText(t, 'loadingTitle')}</SettingSubtitle>
          <p role={controller.error ? 'alert' : 'status'} className="text-sm">
            {controller.error ? t(controller.error, { defaultValue: controller.error }) : t('common.loading')}
          </p>
          {controller.error && (
            <Button variant="outline" onClick={() => void controller.load()}>
              {integrationText(t, 'actions.retry')}
            </Button>
          )}
        </SettingGroup>
      </SettingsContentColumn>
    )
  }

  return (
    <SettingsContentColumn theme={theme}>
      {children(controller)}
      <SettingGroup theme={theme}>
        <IntegrationOperations
          operations={controller.snapshot.operations}
          cancel={(id) => void controller.cancel(id)}
          retry={(operation) => void controller.start(operation.action, operation.workspacePath)}
        />
      </SettingGroup>
      <IntegrationSaveBar controller={controller} />
    </SettingsContentColumn>
  )
}
