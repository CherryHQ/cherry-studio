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

import { IntegrationField } from './IntegrationFields'
import { IntegrationPage, IntegrationSecretField, integrationText } from './IntegrationPage'

export default function LiterLlmSettings() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  return (
    <IntegrationPage>
      {(controller) => (
        <SettingGroup theme={theme}>
          <SettingTitle>{integrationText(t, 'literTitle')}</SettingTitle>
          <SettingDescription>{integrationText(t, 'literDescription')}</SettingDescription>
          <SettingDivider />
          <div className="space-y-5">
            <div id={getSettingDomId('/settings/liter-llm', 'gateway-connection')} className="scroll-mt-6">
              <SettingSubtitle>{integrationText(t, 'gatewayConnection')}</SettingSubtitle>
              <p className="mt-2 break-all text-sm text-foreground-secondary">
                {controller.draft.services.liter.endpoint}
              </p>
              <SettingHelpText className="mt-1">
                {integrationText(t, `source.${controller.draft.services.liter.source}`)}
              </SettingHelpText>
            </div>
            <IntegrationSecretField controller={controller} secret="literKey" />
            <div id={getSettingDomId('/settings/liter-llm', 'model-roles')} className="scroll-mt-6 space-y-5">
              {(['judge', 'critic'] as const).map((role) => (
                <fieldset key={role} className="space-y-3 rounded-md border border-border p-4">
                  <legend className="px-1 text-sm font-medium">{integrationText(t, role)}</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <IntegrationField
                      label={integrationText(t, 'providerModel')}
                      value={controller.draft.services[role].name}
                      onChange={(name) =>
                        controller.update('services', { [role]: { ...controller.draft.services[role], name } })
                      }
                    />
                    <IntegrationField
                      label={integrationText(t, 'providerEndpoint')}
                      value={controller.draft.services[role].baseUrl}
                      onChange={(baseUrl) =>
                        controller.update('services', { [role]: { ...controller.draft.services[role], baseUrl } })
                      }
                    />
                    <IntegrationSecretField
                      controller={controller}
                      secret={role === 'judge' ? 'judgeKey' : 'criticKey'}
                    />
                  </div>
                </fieldset>
              ))}
            </div>
            <SettingHelpText>{integrationText(t, 'modelCatalogPreview')}</SettingHelpText>
          </div>
        </SettingGroup>
      )}
    </IntegrationPage>
  )
}
