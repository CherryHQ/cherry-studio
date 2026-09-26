import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SettingDescription, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'

import { IntegrationPage, IntegrationSecretField } from './IntegrationPage'
import { LiterConfigPanel } from './LiterConfigPanel'
import { LiterDiagnosticsPanel } from './LiterDiagnosticsPanel'
import { LiterGatewayPanel } from './LiterGatewayPanel'
import { LiterModelAliasesPanel } from './LiterModelAliasesPanel'
import { LiterProviderConnectionsPanel } from './LiterProviderConnectionsPanel'
import { LiterRoleAssignmentsPanel } from './LiterRoleAssignmentsPanel'
import type { IntegrationSettingsController } from './useIntegrationSettings'
import { useLiterGatewayAdministration } from './useLiterGatewayAdministration'

function LiterAdministration({ integration }: { integration: IntegrationSettingsController }) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const controller = useLiterGatewayAdministration()
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`settings.prometheus.integration.literAdmin.${key}`, options)

  return (
    <>
      <SettingGroup theme={theme}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <SettingTitle>{tr('title')}</SettingTitle>
            <SettingDescription>{tr('description')}</SettingDescription>
          </div>
          {controller.busy && (
            <span className="flex items-center gap-2 text-sm text-foreground-secondary" role="status">
              <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />
              {tr(`actions.${controller.action}`)}
            </span>
          )}
        </div>
        {controller.error && (
          <p className="mt-3 break-words text-sm text-error" role="alert">
            {controller.error}
          </p>
        )}
        {controller.status && (
          <p className="mt-3 text-sm text-success" role="status">
            {controller.status}
          </p>
        )}
      </SettingGroup>

      <LiterGatewayPanel controller={controller} tr={tr} />
      <SettingGroup theme={theme}>
        <SettingTitle>{tr('credentials.title')}</SettingTitle>
        <SettingDescription>{tr('credentials.description')}</SettingDescription>
        <div className="mt-4 max-w-xl">
          <IntegrationSecretField controller={integration} secret="literKey" />
        </div>
      </SettingGroup>
      <LiterProviderConnectionsPanel controller={controller} tr={tr} />
      <LiterModelAliasesPanel controller={controller} tr={tr} />
      <LiterRoleAssignmentsPanel controller={controller} tr={tr} />
      <LiterConfigPanel controller={controller} tr={tr} />
      <LiterDiagnosticsPanel controller={integration} tr={tr} />
    </>
  )
}

export default function LiterLlmSettings() {
  return <IntegrationPage>{(controller) => <LiterAdministration integration={controller} />}</IntegrationPage>
}
