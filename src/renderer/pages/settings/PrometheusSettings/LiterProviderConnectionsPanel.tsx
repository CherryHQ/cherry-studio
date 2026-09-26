import { useMemo, useState } from 'react'

import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingHelpText, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { getSettingDomId } from '@renderer/pages/settings/settingsSearch/types'
import type { LiterConnection, LiterCredentialMutation } from '@shared/types/literGateway'

import { IntegrationChoice, IntegrationField, IntegrationToggle } from './IntegrationFields'
import type { LiterGatewayAdministrationController } from './useLiterGatewayAdministration'

type ConnectionDraft = {
  mode: 'create' | 'update'
  providerConnectionId: string
  providerId: string
  displayName: string
  baseUrl: string
  timeoutMs: string
  enabled: boolean
  credentialOperation: LiterCredentialMutation['operation']
  credentialValue: string
}

const CUSTOM_PROVIDER = '__custom__'

function emptyDraft(): ConnectionDraft {
  return {
    mode: 'create',
    providerConnectionId: '',
    providerId: '',
    displayName: '',
    baseUrl: '',
    timeoutMs: '60000',
    enabled: true,
    credentialOperation: 'unchanged',
    credentialValue: ''
  }
}

function connectionDraft(connection: LiterConnection): ConnectionDraft {
  return {
    mode: 'update',
    providerConnectionId: connection.providerConnectionId,
    providerId: connection.providerId,
    displayName: connection.displayName,
    baseUrl: connection.baseUrl ?? '',
    timeoutMs: String(connection.timeoutMs),
    enabled: connection.enabled,
    credentialOperation: 'unchanged',
    credentialValue: ''
  }
}

export function LiterProviderConnectionsPanel({
  controller,
  tr
}: {
  controller: LiterGatewayAdministrationController
  tr: (key: string, options?: Record<string, unknown>) => string
}) {
  const [selectedId, setSelectedId] = useState('new')
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft)
  const catalog = controller.catalog
  const providers = catalog?.providers ?? []
  const connection = useMemo(
    () => catalog?.connections.find((item) => item.providerConnectionId === selectedId),
    [catalog?.connections, selectedId]
  )
  const knownProvider = providers.some((provider) => provider.identity.providerId === draft.providerId)
  const providerSelection = knownProvider ? draft.providerId : CUSTOM_PROVIDER

  const selectConnection = (value: string) => {
    setSelectedId(value)
    setDraft(value === 'new' ? emptyDraft() : connectionDraft(catalog!.connections.find((item) => item.providerConnectionId === value)!))
  }

  const selectProvider = (providerId: string) => {
    if (providerId === CUSTOM_PROVIDER) {
      setDraft((current) => ({ ...current, providerId: '' }))
      return
    }
    const provider = providers.find((item) => item.identity.providerId === providerId)
    setDraft((current) => ({
      ...current,
      providerId,
      displayName: current.displayName || provider?.name || '',
      baseUrl: current.baseUrl || provider?.baseUrl || ''
    }))
  }

  const save = async () => {
    const result = await controller.saveConnection({
      mode: draft.mode,
      connection: {
        providerConnectionId: draft.providerConnectionId.trim(),
        providerId: draft.providerId.trim(),
        displayName: draft.displayName.trim(),
        ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {}),
        timeoutMs: Number(draft.timeoutMs),
        enabled: draft.enabled
      },
      credential:
        draft.credentialOperation === 'set'
          ? { operation: 'set', value: draft.credentialValue }
          : { operation: draft.credentialOperation }
    })
    if (result) {
      setSelectedId(draft.providerConnectionId.trim())
      setDraft((current) => ({ ...current, mode: 'update', credentialOperation: 'unchanged', credentialValue: '' }))
    }
  }

  const remove = async () => {
    if (!connection || !window.confirm(tr('connections.deleteConfirm', { name: connection.displayName }))) return
    await controller.deleteConnection(connection.providerConnectionId)
    setSelectedId('new')
    setDraft(emptyDraft())
  }

  const valid =
    Boolean(draft.providerConnectionId.trim() && draft.providerId.trim() && draft.displayName.trim()) &&
    Number.isInteger(Number(draft.timeoutMs)) &&
    Number(draft.timeoutMs) >= 1000 &&
    (draft.credentialOperation !== 'set' || Boolean(draft.credentialValue))

  return (
    <SettingGroup id={getSettingDomId('/settings/liter-llm', 'provider-connections')} className="scroll-mt-6">
      <SettingTitle>{tr('connections.title')}</SettingTitle>
      <SettingDescription>{tr('connections.description')}</SettingDescription>
      <div className="mt-4 grid gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="liter-provider-connection">
            {tr('connections.connection')}
          </label>
          <Select value={selectedId} onValueChange={selectConnection} disabled={controller.busy}>
            <SelectTrigger id="liter-provider-connection" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">{tr('connections.new')}</SelectItem>
              {catalog?.connections.map((item) => (
                <SelectItem key={item.providerConnectionId} value={item.providerConnectionId}>
                  {item.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <IntegrationField
            label={tr('connections.id')}
            value={draft.providerConnectionId}
            onChange={(providerConnectionId) => setDraft((current) => ({ ...current, providerConnectionId }))}
            help={tr('connections.idHelp')}
            disabled={controller.busy || draft.mode === 'update'}
          />
          <IntegrationChoice
            label={tr('connections.provider')}
            value={providerSelection}
            onChange={selectProvider}
            disabled={controller.busy}
            options={[
              ...providers.map((provider) => ({
                value: provider.identity.providerId,
                label: provider.name
              })),
              { value: CUSTOM_PROVIDER, label: tr('connections.customProvider') }
            ]}
          />
          {!knownProvider && (
            <IntegrationField
              label={tr('connections.customProviderId')}
              value={draft.providerId}
              onChange={(providerId) => setDraft((current) => ({ ...current, providerId }))}
              disabled={controller.busy}
            />
          )}
          <IntegrationField
            label={tr('connections.name')}
            value={draft.displayName}
            onChange={(displayName) => setDraft((current) => ({ ...current, displayName }))}
            disabled={controller.busy}
          />
          <IntegrationField
            label={tr('connections.baseUrl')}
            value={draft.baseUrl}
            onChange={(baseUrl) => setDraft((current) => ({ ...current, baseUrl }))}
            help={tr('connections.baseUrlHelp')}
            disabled={controller.busy}
          />
          <IntegrationField
            label={tr('connections.timeout')}
            type="number"
            value={draft.timeoutMs}
            onChange={(timeoutMs) => setDraft((current) => ({ ...current, timeoutMs }))}
            disabled={controller.busy}
          />
          <IntegrationChoice
            label={tr('connections.credentialAction')}
            value={draft.credentialOperation}
            onChange={(credentialOperation) => setDraft((current) => ({ ...current, credentialOperation }))}
            disabled={controller.busy}
            options={(['unchanged', 'set', 'clear'] as const).map((value) => ({
              value,
              label: tr(`connections.credential.${value}`)
            }))}
          />
          {draft.credentialOperation === 'set' && (
            <IntegrationField
              label={tr('connections.credentialValue')}
              type="password"
              value={draft.credentialValue}
              onChange={(credentialValue) => setDraft((current) => ({ ...current, credentialValue }))}
              disabled={controller.busy}
            />
          )}
        </div>

        <IntegrationToggle
          label={tr('connections.enabled')}
          checked={draft.enabled}
          onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}>
          {connection && (
            <SettingHelpText className="mt-1">
              {connection.credentialConfigured
                ? tr('connections.credentialConfigured')
                : tr('connections.credentialMissing')}
            </SettingHelpText>
          )}
        </IntegrationToggle>

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={controller.busy || !valid} onClick={() => void save()}>
            {tr('actions.saveConnection')}
          </Button>
          {connection && (
            <Button variant="destructive" disabled={controller.busy} onClick={() => void remove()}>
              {tr('actions.deleteConnection')}
            </Button>
          )}
          {connection && (
            <Badge variant={connection.knownProvider ? 'outline' : 'secondary'}>
              {connection.knownProvider ? tr('connections.catalogProvider') : tr('connections.customProvider')}
            </Badge>
          )}
        </div>
      </div>
    </SettingGroup>
  )
}
