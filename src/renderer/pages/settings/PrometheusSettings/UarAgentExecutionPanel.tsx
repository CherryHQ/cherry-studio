import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@cherrystudio/ui'
import { useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import type {
  UarAgentCatalogItem,
  UarCatalogSnapshot,
  UarModelSourceSnapshot,
  UarPresentationAdministrationSnapshot,
  UarPresentationSelection
} from '@shared/types/prometheusIntegration'

type WorkflowStage = 'idle' | 'validation' | 'saving' | 'admission' | 'execution'

type Props = {
  agent: UarAgentCatalogItem
  catalog: UarCatalogSnapshot
  draft: string
  skillIds: string[]
  busy: boolean
  onDraftChange: (value: string) => void
  onSkillIdsChange: (value: string[]) => void
  onSave: () => Promise<boolean>
}

const DEFAULT_PRESENTATION: UarPresentationSelection = { mode: 'inherit', ids: [], denied_ids: [] }

function parsedDefinition(source: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(source)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function defaultModel(definition?: Record<string, unknown>): { provider: string; model: string } | undefined {
  const policy = definition?.policy
  const provider =
    policy && typeof policy === 'object' && !Array.isArray(policy)
      ? (policy as Record<string, unknown>).provider
      : undefined
  const selected =
    provider && typeof provider === 'object' && !Array.isArray(provider)
      ? (provider as Record<string, unknown>).default
      : undefined
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) return undefined
  const value = selected as Record<string, unknown>
  return typeof value.provider === 'string' && typeof value.model === 'string'
    ? { provider: value.provider, model: value.model }
    : undefined
}

function presentationSelection(definition?: Record<string, unknown>): UarPresentationSelection {
  const extensions = definition?.extensions
  const runPolicy =
    extensions && typeof extensions === 'object' && !Array.isArray(extensions)
      ? (extensions as Record<string, unknown>)['uar.run_policy']
      : undefined
  const presentations =
    runPolicy && typeof runPolicy === 'object' && !Array.isArray(runPolicy)
      ? (runPolicy as Record<string, unknown>).presentations
      : undefined
  if (!presentations || typeof presentations !== 'object' || Array.isArray(presentations)) return DEFAULT_PRESENTATION
  const value = presentations as Record<string, unknown>
  const mode = ['inherit', 'auto', 'all', 'none', 'selected'].includes(String(value.mode))
    ? (value.mode as UarPresentationSelection['mode'])
    : 'inherit'
  return {
    mode,
    ids: Array.isArray(value.ids) ? value.ids.filter((id): id is string => typeof id === 'string') : [],
    denied_ids: Array.isArray(value.denied_ids)
      ? value.denied_ids.filter((id): id is string => typeof id === 'string')
      : []
  }
}

function withModel(definition: Record<string, unknown>, providerId: string, modelId: string) {
  const next = structuredClone(definition)
  const policy = (next.policy ??= {}) as Record<string, unknown>
  const provider = (policy.provider ??= {}) as Record<string, unknown>
  provider.default = { provider: providerId, model: modelId }
  return next
}

function withPresentation(definition: Record<string, unknown>, selection: UarPresentationSelection) {
  const next = structuredClone(definition)
  const extensions = (next.extensions ??= {}) as Record<string, unknown>
  const runPolicy = (extensions['uar.run_policy'] ??= { version: 1 }) as Record<string, unknown>
  runPolicy.presentations = selection
  return next
}

export function UarAgentExecutionPanel({
  agent,
  catalog,
  draft,
  skillIds,
  busy,
  onDraftChange,
  onSkillIdsChange,
  onSave
}: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`settings.prometheus.integration.uarAdmin.catalog.${key}`, options)
  const { data: workspaces } = useQuery('/agent-workspaces')
  const [models, setModels] = useState<UarModelSourceSnapshot>()
  const [presentations, setPresentations] = useState<UarPresentationAdministrationSnapshot>()
  const [bossModelId, setBossModelId] = useState(agent.bossAgent?.modelId ?? '')
  const [workspace, setWorkspace] = useState('system')
  const [stage, setStage] = useState<WorkflowStage>('idle')
  const [stageError, setStageError] = useState<string>()

  const load = useCallback(async () => {
    const [nextModels, nextPresentations] = await Promise.all([
      ipcApi.request('prometheus.uar.models.sources', {}),
      ipcApi.request('prometheus.uar.presentations.read', {})
    ])
    setModels(nextModels)
    setPresentations(nextPresentations)
  }, [])

  useEffect(() => {
    void load().catch((error) => setStageError(error instanceof Error ? error.message : String(error)))
  }, [load])

  useEffect(() => setBossModelId(agent.bossAgent?.modelId ?? ''), [agent.bossAgent?.modelId, agent.id])

  const definition = useMemo(() => parsedDefinition(draft), [draft])
  const selectedModel = defaultModel(definition)
  const selectedPresentation = presentationSelection(definition)
  const bossModels = useMemo(
    () =>
      models?.sources
        .find((source) => source.source === 'boss')
        ?.providers.flatMap((provider) =>
          provider.enabled
            ? provider.models
                .filter((model) => model.enabled)
                .map((model) => ({ id: model.id, label: `${provider.name} · ${model.name}` }))
            : []
        ) ?? [],
    [models]
  )
  const uarModels = useMemo(
    () =>
      models?.sources
        .find((source) => source.source === 'uar')
        ?.providers.flatMap((provider) =>
          provider.enabled
            ? provider.models
                .filter((model) => model.enabled)
                .map((model) => ({
                  value: `${provider.id}\u0000${model.id}`,
                  providerId: provider.id,
                  modelId: model.id,
                  label: `${provider.name} · ${model.name}`
                }))
            : []
        ) ?? [],
    [models]
  )
  const selectedModelValue = selectedModel ? `${selectedModel.provider}\u0000${selectedModel.model}` : undefined

  const setModel = (value: string) => {
    if (!definition) return
    const [providerId, modelId] = value.split('\u0000')
    if (providerId && modelId) onDraftChange(JSON.stringify(withModel(definition, providerId, modelId), null, 2))
  }

  const setPresentation = (selection: UarPresentationSelection) => {
    if (!definition) return
    onDraftChange(JSON.stringify(withPresentation(definition, selection), null, 2))
  }

  const toggleSkill = (id: string) => {
    onSkillIdsChange(skillIds.includes(id) ? skillIds.filter((skillId) => skillId !== id) : [...skillIds, id].sort())
  }

  const startConversation = async () => {
    setStageError(undefined)
    try {
      setStage('validation')
      if (!definition) throw new Error(tr('definitionInvalid'))
      if (!selectedModel) throw new Error(tr('modelRequired'))
      setStage('saving')
      if (!(await onSave())) throw new Error(tr('saveFailed'))
      setStage('admission')
      const target = await ipcApi.request('prometheus.uar.catalog.prepare_run', {
        agentId: agent.id,
        ...(bossModelId ? { bossModelId } : {})
      })
      const result = await ipcApi.request('ai.agent.session.reuse_or_create', {
        agentId: target.bossAgentId,
        workspace: workspace === 'system' ? { type: 'system' } : { type: 'user', workspaceId: workspace }
      })
      setStage('execution')
      await navigate({ to: '/app/agents', search: { sessionId: result.session.id } })
    } catch (error) {
      setStageError(error instanceof Error ? error.message : String(error))
    }
  }

  const presentationSummary =
    selectedPresentation.mode === 'inherit'
      ? tr('presentationInherited', { mode: presentations?.policy.mode ?? 'inherit' })
      : selectedPresentation.mode === 'selected'
        ? selectedPresentation.ids.join(', ') || tr('presentationNone')
        : tr(`presentationMode.${selectedPresentation.mode}`)

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{tr('workflowTitle')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{tr('workflowDescription')}</p>
        </div>
        <Badge variant={agent.bossAgent ? 'secondary' : 'outline'}>
          {agent.bossAgent ? tr('linkedBossAgent', { name: agent.bossAgent.name }) : tr('catalogOnly')}
        </Badge>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          {tr('modelLabel')}
          <Select value={selectedModelValue} onValueChange={setModel} disabled={busy || !definition}>
            <SelectTrigger>
              <SelectValue placeholder={tr('modelRequired')} />
            </SelectTrigger>
            <SelectContent>
              {uarModels.map((model) => (
                <SelectItem key={model.value} value={model.value}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs font-normal text-muted-foreground">{tr('modelHelp')}</span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          {tr('fallbackModelLabel')}
          <Select value={bossModelId || undefined} onValueChange={setBossModelId} disabled={busy}>
            <SelectTrigger>
              <SelectValue placeholder={tr('fallbackModelRequired')} />
            </SelectTrigger>
            <SelectContent>
              {bossModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs font-normal text-muted-foreground">{tr('fallbackModelHelp')}</span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          {tr('presentationLabel')}
          <Select
            value={selectedPresentation.mode}
            onValueChange={(mode) =>
              setPresentation({ ...selectedPresentation, mode: mode as UarPresentationSelection['mode'] })
            }
            disabled={busy || !definition}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['inherit', 'auto', 'all', 'selected', 'none'].map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {tr(`presentationMode.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          {tr('workspaceLabel')}
          <Select value={workspace} onValueChange={setWorkspace} disabled={busy}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{tr('workspaceSystem')}</SelectItem>
              {(workspaces ?? [])
                .filter((item) => item.type === 'user')
                .map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {selectedPresentation.mode === 'selected' && (
        <div className="mt-4 rounded-lg border border-border p-3">
          <div className="mb-2 text-sm font-medium">{tr('presentationChoices')}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {presentations?.presentations.map((presentation) => (
              <label key={presentation.id} className="flex min-w-0 items-center gap-2 text-sm">
                <Switch
                  checked={selectedPresentation.ids.includes(presentation.id)}
                  onCheckedChange={() =>
                    setPresentation({
                      ...selectedPresentation,
                      ids: selectedPresentation.ids.includes(presentation.id)
                        ? selectedPresentation.ids.filter((id) => id !== presentation.id)
                        : [...selectedPresentation.ids, presentation.id]
                    })
                  }
                />
                <span className="truncate">{presentation.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <details className="mt-4 rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {tr('skillsLabel')} · {skillIds.length}
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {catalog.skills.map((skill) => (
            <label key={skill.id} className="flex min-w-0 items-center gap-2 text-sm">
              <Switch
                checked={skillIds.includes(skill.id)}
                onCheckedChange={() => toggleSkill(skill.id)}
                disabled={!skill.enabled}
              />
              <span className="truncate">{skill.title}</span>
            </label>
          ))}
          {catalog.skills.length === 0 && <span className="text-sm text-muted-foreground">{tr('noSkills')}</span>}
        </div>
      </details>

      <div className="mt-4 rounded-lg border border-border-subtle bg-muted/30 p-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{tr('effectiveTitle')}</div>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">{tr('effectiveAgent')}</dt>
          <dd className="break-all">
            {agent.id} · {agent.revision}
          </dd>
          <dt className="text-muted-foreground">{tr('effectiveModel')}</dt>
          <dd className="break-all">
            {selectedModel ? `${selectedModel.provider}/${selectedModel.model}` : tr('modelRequired')}
          </dd>
          <dt className="text-muted-foreground">{tr('effectivePresentation')}</dt>
          <dd className="break-all">{presentationSummary}</dd>
        </dl>
      </div>

      {stage !== 'idle' && !stageError && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
          {stage === 'execution' ? (
            <CheckCircle2 size={15} className="text-success" />
          ) : (
            <Loader2 size={15} className="animate-spin" />
          )}
          {tr(`stage.${stage}`)}
        </div>
      )}
      {stageError && (
        <div className="mt-4 rounded-lg border border-error-border bg-error-subtle p-3" role="alert">
          <div className="text-sm text-error">
            {tr('runFailed', { stage: tr(`stage.${stage}`) })}: {stageError}
          </div>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void startConversation()}>
            <RotateCcw size={14} aria-hidden="true" /> {tr('retryStage')}
          </Button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          onClick={() => void startConversation()}
          disabled={
            busy ||
            stage === 'saving' ||
            stage === 'admission' ||
            !definition ||
            (!agent.bossAgent?.modelId && !bossModelId)
          }>
          {stage === 'saving' || stage === 'admission' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ArrowRight size={14} />
          )}
          {tr('saveAndRun')}
        </Button>
      </div>
    </div>
  )
}
