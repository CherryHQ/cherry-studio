import { Badge, Button } from '@cherrystudio/ui'
import {
  SettingDescription,
  SettingGroup,
  SettingHelpText,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'

import { IntegrationChoice } from './IntegrationFields'
import type { IntegrationSettingsController } from './useIntegrationSettings'

const NO_WORKSPACE = '__none__'

export function LiterDiagnosticsPanel({
  controller,
  tr
}: {
  controller: IntegrationSettingsController
  tr: (key: string, options?: Record<string, unknown>) => string
}) {
  const operation = controller.snapshot?.operations.find((item) => item.action === 'diagnose')
  const active = operation?.status === 'queued' || operation?.status === 'running'

  return (
    <SettingGroup id={getSettingDomId('/settings/liter-llm', 'gateway-diagnostics')} className="scroll-mt-6">
      <SettingTitle>{tr('diagnostics.title')}</SettingTitle>
      <SettingDescription>{tr('diagnostics.description')}</SettingDescription>
      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <IntegrationChoice
            label={tr('diagnostics.workspace')}
            value={controller.workspace || NO_WORKSPACE}
            onChange={(workspacePath) => controller.setWorkspace(workspacePath === NO_WORKSPACE ? '' : workspacePath)}
            disabled={controller.busy}
            options={[
              { value: NO_WORKSPACE, label: tr('diagnostics.chooseWorkspace') },
              ...(controller.snapshot?.workspaces ?? []).map((workspace) => ({
                value: workspace.path,
                label:
                  workspace.path
                    .split(/[\\/]+/)
                    .filter(Boolean)
                    .at(-1) ?? workspace.path
              }))
            ]}
          />
          <Button
            disabled={controller.busy || !controller.workspace}
            onClick={() => void controller.start('diagnose', controller.workspace)}>
            {active ? tr('diagnostics.running') : tr('actions.runDiagnostics')}
          </Button>
        </div>

        {operation && (
          <div className="rounded-md border border-border p-4" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{tr(`diagnostics.state.${operation.status}`)}</p>
              {operation.completedAt && (
                <SettingHelpText>{new Date(operation.completedAt).toLocaleString()}</SettingHelpText>
              )}
            </div>
            {operation.error && (
              <p className="mt-2 break-words text-sm text-error" role="alert">
                {operation.error}
              </p>
            )}
            {operation.diagnostics?.length ? (
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {operation.diagnostics.map((diagnostic) => (
                  <div
                    key={diagnostic.id}
                    className="flex min-w-0 items-start justify-between gap-3 rounded-md border border-border p-3">
                    <div className="min-w-0">
                      <dt className="break-words text-sm font-medium">{diagnostic.id}</dt>
                      {diagnostic.detail && (
                        <dd className="mt-1 break-words text-xs text-foreground-secondary">{diagnostic.detail}</dd>
                      )}
                    </div>
                    <Badge variant={diagnostic.state === 'operational' ? 'secondary' : 'outline'}>
                      {tr(`diagnostics.result.${diagnostic.state}`)}
                    </Badge>
                  </div>
                ))}
              </dl>
            ) : (
              <SettingHelpText className="mt-2">
                {active ? tr('diagnostics.waiting') : tr('diagnostics.noResults')}
              </SettingHelpText>
            )}
          </div>
        )}
      </div>
    </SettingGroup>
  )
}
