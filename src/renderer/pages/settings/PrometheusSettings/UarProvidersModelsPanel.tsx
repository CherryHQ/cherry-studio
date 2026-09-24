import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import type { UarModelSourceSnapshot, UarProviderMutation } from '@shared/types/prometheusIntegration'

import { IntegrationChoice, IntegrationField, IntegrationToggle } from './IntegrationFields'

type ProviderProjection = UarModelSourceSnapshot['sources'][number]['providers'][number]
type ProviderDraft = Omit<UarProviderMutation, 'models' | 'credential'> & {
  modelsJson: string
  credentialOperation: 'unchanged' | 'set' | 'clear'
  credentialValue: string
}

function emptyDraft(): ProviderDraft {
  return {
    mode: 'create',
    id: '',
    displayName: '',
    baseUrl: '',
    protocol: 'auto',
    defaultModel: undefined,
    modelsJson: '[]',
    enabled: true,
    credentialOperation: 'unchanged',
    credentialValue: ''
  }
}

function providerDraft(provider: ProviderProjection): ProviderDraft {
  return {
    mode: 'update',
    id: provider.id,
    displayName: provider.name,
    baseUrl: provider.baseUrl ?? '',
    protocol: provider.protocol ?? 'auto',
    defaultModel: provider.defaultModel,
    modelsJson: JSON.stringify(
      provider.models.map((model) => ({
        id: model.id,
        displayName: model.name,
        ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
        ...(model.supportsVision === undefined ? {} : { supportsVision: model.supportsVision }),
        ...(model.supportsTools === undefined ? {} : { supportsTools: model.supportsTools }),
        ...(model.supportsReasoning === undefined ? {} : { supportsReasoning: model.supportsReasoning }),
        ...(model.supportsStructuredOutput === undefined
          ? {}
          : { supportsStructuredOutput: model.supportsStructuredOutput }),
        ...(model.supportsStreaming === undefined ? {} : { supportsStreaming: model.supportsStreaming }),
        ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
        enabled: model.enabled
      })),
      null,
      2
    ),
    enabled: provider.enabled,
    credentialOperation: 'unchanged',
    credentialValue: ''
  }
}

function modelsFromJson(value: string): UarProviderMutation['models'] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('models-array')
  return parsed.map((item) => {
    if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string') {
      throw new Error('model-id')
    }
    return { ...item, enabled: !('enabled' in item) || item.enabled !== false } as UarProviderMutation['models'][number]
  })
}

export function UarProvidersModelsPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`settings.prometheus.integration.uarAdmin.models.${key}`, options)
  const [snapshot, setSnapshot] = useState<UarModelSourceSnapshot>()
  const [selectedId, setSelectedId] = useState<string>('new')
  const [draft, setDraft] = useState<ProviderDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [status, setStatus] = useState<string>()

  const load = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setSnapshot(await ipcApi.request('prometheus.uar.models.sources', {}))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const uarSource = snapshot?.sources.find((source) => source.source === 'uar')
  const selectedProvider = useMemo(
    () => uarSource?.providers.find((provider) => provider.id === selectedId),
    [selectedId, uarSource]
  )

  const selectProvider = (id: string) => {
    setSelectedId(id)
    setDraft(id === 'new' ? emptyDraft() : providerDraft(uarSource!.providers.find((item) => item.id === id)!))
    setError(undefined)
    setStatus(undefined)
  }

  const mutation = (): UarProviderMutation => ({
    mode: draft.mode,
    id: draft.id.trim(),
    displayName: draft.displayName.trim(),
    baseUrl: draft.baseUrl.trim(),
    protocol: draft.protocol,
    ...(draft.defaultModel?.trim() ? { defaultModel: draft.defaultModel.trim() } : {}),
    models: modelsFromJson(draft.modelsJson),
    enabled: draft.enabled,
    credential:
      draft.credentialOperation === 'set'
        ? { operation: 'set', value: draft.credentialValue }
        : { operation: draft.credentialOperation }
  })

  const save = async () => {
    setBusy(true)
    setError(undefined)
    setStatus(undefined)
    try {
      const next = await ipcApi.request('prometheus.uar.providers.save', mutation())
      setSnapshot(next)
      setSelectedId(draft.id.trim())
      const saved = next.sources
        .find((source) => source.source === 'uar')
        ?.providers.find((item) => item.id === draft.id.trim())
      if (saved) setDraft(providerDraft(saved))
      setStatus(t('common.saved'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusy(false)
    }
  }

  const runProviderAction = async (action: 'delete' | 'default' | 'test') => {
    if (!selectedProvider) return
    if (action === 'delete' && !window.confirm(tr('deleteConfirm', { provider: selectedProvider.name }))) return
    setBusy(true)
    setError(undefined)
    setStatus(undefined)
    try {
      if (action === 'delete') {
        setSnapshot(await ipcApi.request('prometheus.uar.providers.delete', { id: selectedProvider.id }))
        selectProvider('new')
        setStatus(t('common.delete_success'))
      } else if (action === 'default') {
        setSnapshot(await ipcApi.request('prometheus.uar.providers.default', { id: selectedProvider.id }))
        setStatus(tr('defaultChanged'))
      } else {
        const modelId = draft.defaultModel || selectedProvider.models.find((model) => model.enabled)?.id
        if (!modelId) throw new Error(tr('testNeedsModel'))
        const result = await ipcApi.request('prometheus.uar.providers.test', { id: selectedProvider.id, modelId })
        setStatus(tr('testSucceeded', { latency: result.latencyMs }))
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <SettingGroup>
        <SettingTitle>{tr('sourcesTitle')}</SettingTitle>
        <SettingDescription>{tr('sourcesDescription')}</SettingDescription>
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {snapshot?.sources.map((source) => (
            <div key={source.source} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{source.instanceName}</div>
                  <div className="mt-1 break-all text-xs text-muted-foreground">{source.connectedInstance}</div>
                </div>
                <Badge variant={source.operational ? 'secondary' : 'outline'}>
                  {source.operational
                    ? t('settings.prometheus.integration.states.operational')
                    : t('settings.prometheus.integration.uarAdmin.adapter.unavailable')}
                </Badge>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {tr('providerCount', { count: source.providers.length })}
              </div>
              {source.error && <div className="mt-2 text-xs text-error">{source.error}</div>}
              {source.source !== 'uar' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() =>
                    void navigate({ to: source.source === 'boss' ? '/settings/provider' : '/settings/liter-llm' })
                  }>
                  {tr('manageInSource')}
                </Button>
              )}
            </div>
          ))}
        </div>
      </SettingGroup>

      <SettingGroup>
        <SettingTitle>{tr('consumersTitle')}</SettingTitle>
        <SettingDescription>{tr('consumersDescription')}</SettingDescription>
        <div className="mt-4 divide-y divide-border-subtle rounded-xl border border-border">
          {snapshot?.consumers.map((consumer) => (
            <div key={consumer.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div>
                <div className="text-sm font-medium">{tr(`consumer.${consumer.id}`)}</div>
                {consumer.effectiveIdentity && <code className="mt-1 block text-xs">{consumer.effectiveIdentity}</code>}
              </div>
              <Badge variant="outline">{tr(`consumerState.${consumer.state}`)}</Badge>
            </div>
          ))}
        </div>
      </SettingGroup>

      <SettingGroup>
        <SettingTitle>{tr('uarTitle')}</SettingTitle>
        <SettingDescription>{tr('uarDescription')}</SettingDescription>
        <div className="mt-4 grid gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="uar-provider-select">
              {tr('provider')}
            </label>
            <Select value={selectedId} onValueChange={selectProvider}>
              <SelectTrigger id="uar-provider-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">{tr('newProvider')}</SelectItem>
                {uarSource?.providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <IntegrationField
              label={tr('providerId')}
              value={draft.id}
              onChange={(id) => setDraft({ ...draft, id })}
              disabled={draft.mode === 'update' || busy}
            />
            <IntegrationField
              label={tr('displayName')}
              value={draft.displayName}
              onChange={(displayName) => setDraft({ ...draft, displayName })}
              disabled={busy}
            />
            <IntegrationField
              label={tr('baseUrl')}
              value={draft.baseUrl}
              onChange={(baseUrl) => setDraft({ ...draft, baseUrl })}
              disabled={busy}
            />
            <IntegrationChoice
              label={tr('protocol')}
              value={draft.protocol}
              onChange={(protocol) => setDraft({ ...draft, protocol })}
              options={[
                { value: 'auto', label: tr('protocolAuto') },
                { value: 'chat', label: tr('protocolChat') },
                { value: 'responses', label: tr('protocolResponses') }
              ]}
              disabled={busy}
            />
            <IntegrationField
              label={tr('defaultModel')}
              value={draft.defaultModel ?? ''}
              onChange={(defaultModel) => setDraft({ ...draft, defaultModel })}
              disabled={busy}
            />
            <IntegrationChoice
              label={tr('credentialAction')}
              value={draft.credentialOperation}
              onChange={(credentialOperation) => setDraft({ ...draft, credentialOperation, credentialValue: '' })}
              options={[
                { value: 'unchanged', label: tr('credentialUnchanged') },
                { value: 'set', label: tr('credentialSet') },
                { value: 'clear', label: tr('credentialClear') }
              ]}
              disabled={busy}
            />
          </div>
          {draft.credentialOperation === 'set' && (
            <IntegrationField
              type="password"
              label={tr('apiKey')}
              value={draft.credentialValue}
              onChange={(credentialValue) => setDraft({ ...draft, credentialValue })}
              disabled={busy}
              help={tr('apiKeyHelp')}
            />
          )}
          <IntegrationToggle
            label={t('common.enabled')}
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="uar-provider-models">
              {t('common.models')}
            </label>
            <Textarea.Input
              id="uar-provider-models"
              rows={8}
              value={draft.modelsJson}
              onValueChange={(modelsJson) => setDraft({ ...draft, modelsJson })}
              disabled={busy}
            />
            <div className="text-xs text-muted-foreground">{tr('modelsHelp')}</div>
          </div>
          {selectedProvider?.credentialConfigured && (
            <div className="text-xs text-muted-foreground">{tr('credentialConfigured')}</div>
          )}
          {error && (
            <div className="rounded-lg border border-error-border bg-error-subtle p-3 text-sm text-error">{error}</div>
          )}
          {status && (
            <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{status}</div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {selectedProvider && (
              <Button variant="outline" onClick={() => void runProviderAction('test')} disabled={busy}>
                {tr('test')}
              </Button>
            )}
            {selectedProvider && !selectedProvider.isDefault && (
              <Button variant="outline" onClick={() => void runProviderAction('default')} disabled={busy}>
                {tr('makeDefault')}
              </Button>
            )}
            {selectedProvider && (
              <Button variant="outline" onClick={() => void runProviderAction('delete')} disabled={busy}>
                {t('common.delete')}
              </Button>
            )}
            <Button onClick={() => void save()} disabled={busy}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </SettingGroup>
    </div>
  )
}
