import { useTranslation } from 'react-i18next'

import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'

import { IntegrationChoice, IntegrationField } from './IntegrationFields'
import { IntegrationPage, IntegrationSecretField, integrationText } from './IntegrationPage'
import { UarIntegrationStatus } from './UarIntegrationStatus'

export default function UarSettings() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  return (
    <IntegrationPage>
      {(controller) => {
        const snapshot = controller.snapshot!
        return (
          <>
            <SettingGroup
              theme={theme}
              id={getSettingDomId('/settings/uar', 'runtime-storage')}
              className="scroll-mt-6">
              <SettingTitle>{integrationText(t, 'uar')}</SettingTitle>
              <SettingDescription>{integrationText(t, 'uarDescription')}</SettingDescription>
              <SettingDivider />
              <div className="space-y-4">
                <IntegrationChoice
                  label={integrationText(t, 'uarBackend')}
                  value={controller.draft.uar.backend}
                  onChange={(backend) => controller.update('uar', { backend })}
                  options={(['embedded', 'remote'] as const).map((value) => ({
                    value,
                    label: integrationText(t, value === 'embedded' ? 'uarBackendLocal' : 'backends.remote')
                  }))}
                />
                {controller.draft.uar.backend === 'remote' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <IntegrationField
                      label={integrationText(t, 'endpoint')}
                      value={controller.draft.uar.endpoint}
                      onChange={(endpoint) => controller.update('uar', { endpoint })}
                    />
                    <IntegrationField
                      label={integrationText(t, 'namespace')}
                      value={controller.draft.uar.namespace}
                      onChange={(namespace) => controller.update('uar', { namespace })}
                    />
                    <IntegrationField
                      label={integrationText(t, 'database')}
                      value={controller.draft.uar.database}
                      onChange={(database) => controller.update('uar', { database })}
                    />
                    <IntegrationField
                      label={integrationText(t, 'username')}
                      value={controller.draft.uar.username}
                      onChange={(username) => controller.update('uar', { username })}
                    />
                    <IntegrationChoice
                      label={integrationText(t, 'authLevel')}
                      value={controller.draft.uar.authLevel}
                      onChange={(authLevel) => controller.update('uar', { authLevel })}
                      options={(['root', 'namespace', 'database'] as const).map((value) => ({
                        value,
                        label: integrationText(t, `auth.${value}`)
                      }))}
                    />
                    <IntegrationSecretField controller={controller} secret="uarPassword" />
                  </div>
                )}
                <SettingHelpText>{integrationText(t, 'uarStorageHelp')}</SettingHelpText>
              </div>
            </SettingGroup>
            <UarIntegrationStatus
              snapshot={snapshot}
              busy={controller.busy}
              dirty={controller.dirty}
              theme={theme}
              text={(key) => integrationText(t, key)}
              start={(action) => void controller.start(action)}
              id={getSettingDomId('/settings/uar', 'runtime-status')}
            />
          </>
        )
      }}
    </IntegrationPage>
  )
}
