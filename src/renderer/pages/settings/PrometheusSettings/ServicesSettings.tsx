import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
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

const services = ['surrealdb', 'memory', 'liter'] as const

export default function ServicesSettings() {
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
                  {(['pull', 'start', 'stop', 'restart', 'status', 'logs'] as const).map((action) => (
                    <IntegrationActionButton key={action} controller={controller} action={action} />
                  ))}
                </div>
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
