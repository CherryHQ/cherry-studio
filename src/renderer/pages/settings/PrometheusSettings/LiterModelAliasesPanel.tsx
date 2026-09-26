import { useMemo, useState } from 'react'

import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingHelpText, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'
import type { LiterServedAlias } from '@shared/types/literGateway'

import { IntegrationChoice, IntegrationField, IntegrationToggle } from './IntegrationFields'
import type { LiterGatewayAdministrationController } from './useLiterGatewayAdministration'

type AliasDraft = {
  mode: 'create' | 'update'
  alias: string
  displayName: string
  providerConnectionId: string
  modelId: string
  enabled: boolean
}

const CUSTOM_MODEL = '__custom__'
const NO_CONNECTION = '__none__'

function emptyDraft(): AliasDraft {
  return {
    mode: 'create',
    alias: '',
    displayName: '',
    providerConnectionId: '',
    modelId: '',
    enabled: true
  }
}

function aliasKey(alias: LiterServedAlias): string {
  return JSON.stringify([alias.identity.gatewayConnectionId, alias.identity.alias])
}

function aliasDraft(alias: LiterServedAlias): AliasDraft {
  return {
    mode: alias.source === 'live' ? 'create' : 'update',
    alias: alias.identity.alias,
    displayName: alias.displayName,
    providerConnectionId: alias.target?.providerConnectionId ?? '',
    modelId: alias.target?.modelId ?? alias.identity.alias,
    enabled: alias.enabled
  }
}

export function LiterModelAliasesPanel({
  controller,
  tr
}: {
  controller: LiterGatewayAdministrationController
  tr: (key: string, options?: Record<string, unknown>) => string
}) {
  const [selectedKey, setSelectedKey] = useState('new')
  const [draft, setDraft] = useState<AliasDraft>(emptyDraft)
  const catalog = controller.catalog
  const currentGatewayId = catalog?.gateway.identity.gatewayConnectionId ?? ''
  const aliases = (catalog?.aliases ?? []).filter(
    (alias) => alias.identity.gatewayConnectionId === currentGatewayId
  )
  const selectedAlias = aliases.find((alias) => aliasKey(alias) === selectedKey)
  const connection = catalog?.connections.find(
    (item) => item.providerConnectionId === draft.providerConnectionId
  )
  const provider = catalog?.providers.find((item) => item.identity.providerId === connection?.providerId)
  const knownModel = provider?.models.some((model) => model.identity.modelId === draft.modelId) ?? false
  const modelSelection = knownModel ? draft.modelId : CUSTOM_MODEL
  const configuredAliases = useMemo(
    () => aliases.filter((alias) => alias.source !== 'live'),
    [aliases]
  )

  const selectAlias = (value: string) => {
    setSelectedKey(value)
    setDraft(value === 'new' ? emptyDraft() : aliasDraft(aliases.find((alias) => aliasKey(alias) === value)!))
  }

  const selectConnection = (providerConnectionId: string) => {
    const nextConnection = catalog?.connections.find((item) => item.providerConnectionId === providerConnectionId)
    const nextProvider = catalog?.providers.find(
      (item) => item.identity.providerId === nextConnection?.providerId
    )
    setDraft((current) => ({
      ...current,
      providerConnectionId,
      modelId: nextProvider?.models[0]?.identity.modelId ?? ''
    }))
  }

  const save = async () => {
    if (!connection) return
    const result = await controller.saveAlias({
      mode: draft.mode,
      alias: {
        gatewayConnectionId: currentGatewayId,
        alias: draft.alias.trim(),
        target: {
          providerConnectionId: connection.providerConnectionId,
          providerId: connection.providerId,
          modelId: draft.modelId.trim()
        },
        ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}),
        enabled: draft.enabled,
        custom: !knownModel
      }
    })
    if (result) {
      const nextKey = JSON.stringify([currentGatewayId, draft.alias.trim()])
      setSelectedKey(nextKey)
      setDraft((current) => ({ ...current, mode: 'update' }))
    }
  }

  const remove = async () => {
    if (!selectedAlias || selectedAlias.source === 'live') return
    if (!window.confirm(tr('aliases.deleteConfirm', { name: selectedAlias.displayName }))) return
    const result = await controller.deleteAlias(
      selectedAlias.identity.gatewayConnectionId,
      selectedAlias.identity.alias
    )
    if (result) {
      setSelectedKey('new')
      setDraft(emptyDraft())
    }
  }

  const valid = Boolean(
    currentGatewayId &&
      draft.alias.trim() &&
      draft.providerConnectionId &&
      draft.modelId.trim() &&
      connection
  )

  return (
    <SettingGroup id={getSettingDomId('/settings/liter-llm', 'model-aliases')} className="scroll-mt-6">
      <SettingTitle>{tr('aliases.title')}</SettingTitle>
      <SettingDescription>{tr('aliases.description')}</SettingDescription>
      <div className="mt-4 grid gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="liter-model-alias">
            {tr('aliases.alias')}
          </label>
          <Select value={selectedKey} onValueChange={selectAlias} disabled={controller.busy}>
            <SelectTrigger id="liter-model-alias" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">{tr('aliases.new')}</SelectItem>
              {aliases.map((alias) => (
                <SelectItem key={aliasKey(alias)} value={aliasKey(alias)}>
                  {alias.displayName} · {tr(`aliases.source.${alias.source}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <IntegrationField
            label={tr('aliases.servedName')}
            value={draft.alias}
            onChange={(alias) => setDraft((current) => ({ ...current, alias }))}
            help={tr('aliases.servedNameHelp')}
            disabled={controller.busy || draft.mode === 'update'}
          />
          <IntegrationField
            label={tr('aliases.displayName')}
            value={draft.displayName}
            onChange={(displayName) => setDraft((current) => ({ ...current, displayName }))}
            disabled={controller.busy}
          />
          <IntegrationChoice
            label={tr('aliases.connection')}
            value={draft.providerConnectionId || NO_CONNECTION}
            onChange={(providerConnectionId) =>
              selectConnection(providerConnectionId === NO_CONNECTION ? '' : providerConnectionId)
            }
            disabled={controller.busy}
            options={[
              { value: NO_CONNECTION, label: tr('aliases.chooseConnection') },
              ...(catalog?.connections ?? []).map((item) => ({
                value: item.providerConnectionId,
                label: item.displayName
              }))
            ]}
          />
          <IntegrationChoice
            label={tr('aliases.model')}
            value={modelSelection}
            onChange={(modelId) =>
              setDraft((current) => ({ ...current, modelId: modelId === CUSTOM_MODEL ? '' : modelId }))
            }
            disabled={controller.busy || !connection}
            options={[
              ...(provider?.models ?? []).map((model) => ({
                value: model.identity.modelId,
                label: model.name
              })),
              { value: CUSTOM_MODEL, label: tr('aliases.customModel') }
            ]}
          />
          {!knownModel && (
            <IntegrationField
              label={tr('aliases.customModelId')}
              value={draft.modelId}
              onChange={(modelId) => setDraft((current) => ({ ...current, modelId }))}
              help={tr('aliases.customModelIdHelp')}
              disabled={controller.busy || !connection}
            />
          )}
        </div>

        <IntegrationToggle
          label={tr('aliases.enabled')}
          checked={draft.enabled}
          onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={controller.busy || !valid} onClick={() => void save()}>
            {tr('actions.saveAlias')}
          </Button>
          {selectedAlias?.source !== 'live' && selectedAlias && (
            <Button variant="destructive" disabled={controller.busy} onClick={() => void remove()}>
              {tr('actions.deleteAlias')}
            </Button>
          )}
          {selectedAlias && (
            <Badge variant={selectedAlias.available ? 'secondary' : 'outline'}>
              {selectedAlias.reconciliation === 'resolved'
                ? selectedAlias.available
                  ? tr('aliases.available')
                  : tr('aliases.configured')
                : tr('aliases.needsMapping')}
            </Badge>
          )}
        </div>

        <SettingHelpText>
          {tr('aliases.summary', {
            configured: configuredAliases.length,
            live: aliases.filter((alias) => alias.available).length
          })}
        </SettingHelpText>
      </div>
    </SettingGroup>
  )
}
