import { useState } from 'react'

import { Badge, Button } from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingHelpText, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'

import { IntegrationField } from './IntegrationFields'
import type { LiterGatewayAdministrationController } from './useLiterGatewayAdministration'

export function LiterConfigPanel({
  controller,
  tr
}: {
  controller: LiterGatewayAdministrationController
  tr: (key: string, options?: Record<string, unknown>) => string
}) {
  const [remoteEndpoint, setRemoteEndpoint] = useState('')
  const sourceLabel =
    controller.configSource.ownership === 'managed' ? tr('config.managed') : tr('config.local')
  const validation = controller.config?.validation

  return (
    <SettingGroup id={getSettingDomId('/settings/liter-llm', 'gateway-configuration')} className="scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SettingTitle>{tr('config.title')}</SettingTitle>
          <SettingDescription>{tr('config.description')}</SettingDescription>
        </div>
        {controller.config && (
          <Badge variant={validation?.valid ? 'secondary' : 'outline'}>
            {validation?.valid ? tr('status.valid') : tr('status.invalid')}
          </Badge>
        )}
      </div>

      <div className="mt-4 grid gap-4">
        <div className="rounded-md border border-border p-4">
          <p className="text-sm font-medium">{sourceLabel}</p>
          <p className="mt-1 break-all text-xs text-foreground-secondary">
            {controller.config?.path ?? tr('status.loading')}
          </p>
          {controller.config?.checker && (
            <SettingHelpText className="mt-2">
              {controller.config.checker.available
                ? tr('config.checkerAvailable', { version: controller.config.checker.version ?? tr('status.unknown') })
                : tr('config.checkerUnavailable')}
            </SettingHelpText>
          )}
          {validation && !validation.valid && (
            <p className="mt-2 break-words text-sm text-error" role="alert">
              {validation.message}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={controller.busy}
            onClick={() => void controller.readConfig({ ownership: 'managed' })}>
            {tr('actions.useManagedConfig')}
          </Button>
          <Button variant="outline" disabled={controller.busy} onClick={() => void controller.selectLocalConfig()}>
            {tr('actions.chooseLocalConfig')}
          </Button>
          <Button variant="outline" disabled={controller.busy || !controller.config} onClick={() => void controller.previewConfig()}>
            {tr('actions.previewConfig')}
          </Button>
          <Button disabled={controller.busy || !controller.config} onClick={() => void controller.applyConfig()}>
            {tr('actions.applyConfig')}
          </Button>
          <Button variant="outline" disabled={controller.busy || !controller.config} onClick={() => void controller.exportConfig()}>
            {tr('actions.exportConfig')}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <IntegrationField
            label={tr('config.remoteEndpoint')}
            value={remoteEndpoint}
            onChange={setRemoteEndpoint}
            help={tr('config.remoteEndpointHelp')}
            disabled={controller.busy}
          />
          <Button
            variant="outline"
            disabled={controller.busy || !controller.config || !remoteEndpoint.trim()}
            onClick={() => void controller.exportConfig(remoteEndpoint.trim())}>
            {tr('actions.exportRemote')}
          </Button>
        </div>

        {controller.configResult && (
          <div className="rounded-md border border-border bg-background-subtle p-4" aria-live="polite">
            {'state' in controller.configResult && controller.configResult.state && (
              <p className="text-sm font-medium">{tr(`config.state.${controller.configResult.state}`)}</p>
            )}
            {'changedPaths' in controller.configResult && (
              <SettingHelpText className="mt-1">
                {controller.configResult.changedPaths.length
                  ? tr('config.changed', { count: controller.configResult.changedPaths.length })
                  : tr('config.unchanged')}
              </SettingHelpText>
            )}
            {'backupPath' in controller.configResult && controller.configResult.backupPath && (
              <SettingHelpText className="mt-1 break-all">
                {tr('config.backup')}: {controller.configResult.backupPath}
              </SettingHelpText>
            )}
            {'path' in controller.configResult && controller.configResult.path && (
              <SettingHelpText className="mt-1 break-all">
                {tr('config.exported')}: {controller.configResult.path}
              </SettingHelpText>
            )}
          </div>
        )}
      </div>
    </SettingGroup>
  )
}
