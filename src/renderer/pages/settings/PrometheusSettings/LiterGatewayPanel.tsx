import { useEffect, useMemo, useState } from 'react'

import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingHelpText, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'

import { IntegrationField } from './IntegrationFields'
import type { LiterGatewayAdministrationController } from './useLiterGatewayAdministration'

type Candidate = NonNullable<LiterGatewayAdministrationController['catalog']>['gateway']['candidates'][number]

function candidateValue(candidate: Candidate): string {
  return JSON.stringify([candidate.id, candidate.source, candidate.ownership])
}

function selectedValue(candidates: Candidate[]): string {
  const selected = candidates.find((candidate) => candidate.selected)
  return selected ? candidateValue(selected) : 'manual'
}

export function LiterGatewayPanel({
  controller,
  tr
}: {
  controller: LiterGatewayAdministrationController
  tr: (key: string, options?: Record<string, unknown>) => string
}) {
  const [manualEndpoint, setManualEndpoint] = useState(controller.catalog?.gateway.endpoint ?? '')
  const candidates = controller.catalog?.gateway.candidates ?? []
  const currentValue = useMemo(() => selectedValue(candidates), [candidates])

  useEffect(() => {
    if (!manualEndpoint && controller.catalog?.gateway.endpoint) {
      setManualEndpoint(controller.catalog.gateway.endpoint)
    }
  }, [controller.catalog?.gateway.endpoint, manualEndpoint])

  const selectCandidate = (value: string) => {
    if (value === 'manual') return
    const [candidateId, source, ownership] = JSON.parse(value) as [Candidate['id'], Candidate['source'], Candidate['ownership']]
    void controller.selectGateway({ kind: 'discovered', candidateId, source, ownership })
  }

  const gateway = controller.catalog?.gateway
  return (
    <SettingGroup id={getSettingDomId('/settings/liter-llm', 'gateway-connection')} className="scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SettingTitle>{tr('gateway.title')}</SettingTitle>
          <SettingDescription>{tr('gateway.description')}</SettingDescription>
        </div>
        {gateway && (
          <Badge variant={gateway.operational ? 'secondary' : 'outline'}>
            {gateway.operational ? tr('status.operational') : tr('status.unavailable')}
          </Badge>
        )}
      </div>

      {gateway && (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="liter-gateway-source">
                {tr('gateway.source')}
              </label>
              <Select value={currentValue} onValueChange={selectCandidate} disabled={controller.busy}>
                <SelectTrigger id="liter-gateway-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((candidate) => (
                    <SelectItem key={candidateValue(candidate)} value={candidateValue(candidate)}>
                      {candidate.label} · {candidate.endpoint}
                    </SelectItem>
                  ))}
                  <SelectItem value="manual">{tr('gateway.customEndpoint')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => void controller.refreshCatalog()} disabled={controller.busy}>
              {tr('actions.refresh')}
            </Button>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{tr('gateway.active')}</div>
                <div className="mt-1 break-all text-muted-foreground">{gateway.endpoint}</div>
              </div>
              <Badge variant="outline">{tr(`ownership.${gateway.ownership}`)}</Badge>
            </div>
            {gateway.error && (
              <SettingHelpText className="mt-2 text-error" role="alert">
                {gateway.error}
              </SettingHelpText>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <IntegrationField
              label={tr('gateway.manualEndpoint')}
              value={manualEndpoint}
              onChange={setManualEndpoint}
              help={tr('gateway.manualEndpointHelp')}
              disabled={controller.busy}
            />
            <Button
              variant="outline"
              disabled={controller.busy || !manualEndpoint.trim()}
              onClick={() => void controller.selectGateway({ kind: 'manual', endpoint: manualEndpoint.trim() })}>
              {tr('actions.useEndpoint')}
            </Button>
          </div>

          <SettingHelpText>
            {tr('gateway.catalogRevision', { revision: controller.catalog?.catalog.revision.slice(0, 12) })}
          </SettingHelpText>
        </div>
      )}
    </SettingGroup>
  )
}
