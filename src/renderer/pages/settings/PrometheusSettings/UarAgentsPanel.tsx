import { useBlocker, useNavigate, useSearch } from '@tanstack/react-router'
import { Download, FileJson, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, ConfirmDialog, Input, Textarea } from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import type { UarAgentCatalogItem, UarCatalogSnapshot } from '@shared/types/prometheusIntegration'

import { UarAgentExecutionPanel } from './UarAgentExecutionPanel'

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function cloneDefinition(agent: UarAgentCatalogItem): Record<string, unknown> {
  const definition = structuredClone(agent.definition)
  delete (definition.extensions as Record<string, unknown> | undefined)?.['uar.catalog']
  return definition
}

export function UarAgentsPanel() {
  const { t } = useTranslation()
  const navigate = useNavigate({ from: '/settings/uar' })
  const search = useSearch({ from: '/settings/uar' })
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`settings.prometheus.integration.uarAdmin.catalog.${key}`, options)
  const importRef = useRef<HTMLInputElement>(null)
  const allowNavigationRef = useRef(false)
  const [snapshot, setSnapshot] = useState<UarCatalogSnapshot>()
  const [selectedId, setSelectedId] = useState<string | undefined>(search.agentId)
  const [draft, setDraft] = useState('')
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([])
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [status, setStatus] = useState<string>()
  const [federatedName, setFederatedName] = useState('')
  const [federatedId, setFederatedId] = useState('')
  const [federatedUrl, setFederatedUrl] = useState('')
  const [federatedDescription, setFederatedDescription] = useState('')
  const [federatedCapabilities, setFederatedCapabilities] = useState('')
  const [pendingAgentId, setPendingAgentId] = useState<string>()

  const load = useCallback(async () => {
    setBusy('load')
    setError(undefined)
    try {
      const next = await ipcApi.request('prometheus.uar.catalog.read', {})
      setSnapshot(next)
      if (selectedId) {
        const selected = next.agents.find((agent) => agent.id === selectedId)
        if (selected) {
          setDraft(JSON.stringify(selected.definition, null, 2))
          setDraftSkillIds(selected.skillIds)
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setBusy(undefined)
    }
  }, [selectedId])

  useEffect(() => {
    void load()
  }, [load])

  const applyAgentSelection = (agent?: UarAgentCatalogItem) => {
    setSelectedId(agent?.id)
    setDraft(agent ? JSON.stringify(agent.definition, null, 2) : '')
    setDraftSkillIds(agent?.skillIds ?? [])
    setError(undefined)
    setStatus(undefined)
    allowNavigationRef.current = true
    void navigate({ search: (previous) => ({ ...previous, agentId: agent?.id }), replace: true }).finally(() => {
      allowNavigationRef.current = false
    })
  }

  const selectAgent = (agent?: UarAgentCatalogItem) => {
    if (isDirty && agent?.id !== selectedId) {
      setPendingAgentId(agent?.id ?? '__new__')
      return
    }
    applyAgentSelection(agent)
  }

  const saveAgent = async () => {
    setBusy('save')
    setError(undefined)
    setStatus(undefined)
    try {
      const definition = JSON.parse(draft) as Record<string, unknown>
      const id = typeof definition.id === 'string' ? definition.id : ''
      if (!id) throw new Error(tr('idRequired'))
      const existing = snapshot?.agents.find((agent) => agent.id === selectedId)
      let next = await ipcApi.request('prometheus.uar.catalog.save_agent', {
        mode: existing ? 'replace' : 'create',
        id,
        ...(existing ? { expectedRevision: existing.revision } : {}),
        definition
      })
      if (JSON.stringify([...(existing?.skillIds ?? [])].sort()) !== JSON.stringify([...draftSkillIds].sort())) {
        next = await ipcApi.request('prometheus.uar.catalog.save_agent_skills', {
          agentId: id,
          skillIds: draftSkillIds
        })
      }
      setSnapshot(next)
      const saved = next.agents.find((agent) => agent.id === id)
      setSelectedId(id)
      if (saved) {
        setDraft(JSON.stringify(saved.definition, null, 2))
        setDraftSkillIds(saved.skillIds)
      }
      allowNavigationRef.current = true
      void navigate({ search: (previous) => ({ ...previous, agentId: id }), replace: true }).finally(() => {
        allowNavigationRef.current = false
      })
      setStatus(tr('saved'))
      return true
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      return false
    } finally {
      setBusy(undefined)
    }
  }

  const duplicate = () => {
    const selected = snapshot?.agents.find((agent) => agent.id === selectedId)
    if (!selected) return
    const definition = cloneDefinition(selected)
    definition.id = `${selected.id}-copy`
    setSelectedId(undefined)
    setDraft(JSON.stringify(definition, null, 2))
    setDraftSkillIds(selected.skillIds)
    allowNavigationRef.current = true
    void navigate({ search: (previous) => ({ ...previous, agentId: undefined }), replace: true }).finally(() => {
      allowNavigationRef.current = false
    })
    setStatus(tr('duplicateReady'))
  }

  const remove = async () => {
    if (!selectedId || !window.confirm(tr('deleteConfirm', { id: selectedId }))) return
    setBusy('delete')
    setError(undefined)
    try {
      setSnapshot(await ipcApi.request('prometheus.uar.catalog.delete_agent', { id: selectedId }))
      selectAgent()
      setStatus(tr('deleted'))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusy(undefined)
    }
  }

  const importAgent = async (file?: File) => {
    if (!file) return
    try {
      const definition = JSON.parse(await file.text()) as Record<string, unknown>
      setSelectedId(undefined)
      setDraft(JSON.stringify(definition, null, 2))
      setDraftSkillIds([])
      allowNavigationRef.current = true
      void navigate({ search: (previous) => ({ ...previous, agentId: undefined }), replace: true }).finally(() => {
        allowNavigationRef.current = false
      })
      setStatus(tr('importReady'))
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError))
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  const saveFederated = async () => {
    setBusy('federation')
    setError(undefined)
    try {
      setSnapshot(
        await ipcApi.request('prometheus.uar.catalog.save_federated_agent', {
          ...(federatedId.trim() ? { id: federatedId.trim() } : {}),
          name: federatedName.trim(),
          description: federatedDescription.trim(),
          baseUrl: federatedUrl.trim(),
          capabilities: federatedCapabilities
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        })
      )
      setStatus(tr('federatedSaved'))
    } catch (federationError) {
      setError(federationError instanceof Error ? federationError.message : String(federationError))
    } finally {
      setBusy(undefined)
    }
  }

  const selected = snapshot?.agents.find((agent) => agent.id === selectedId)
  const isDirty = selected
    ? draft !== JSON.stringify(selected.definition, null, 2) ||
      JSON.stringify([...draftSkillIds].sort()) !== JSON.stringify([...selected.skillIds].sort())
    : Boolean(draft.trim())
  const blocker = useBlocker({
    shouldBlockFn: () => !allowNavigationRef.current,
    enableBeforeUnload: () => isDirty,
    disabled: !isDirty,
    withResolver: true
  })
  return (
    <div className="space-y-5">
      <SettingGroup>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SettingTitle>{tr('title')}</SettingTitle>
            <SettingDescription>{tr('description')}</SettingDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={Boolean(busy)}>
            <RefreshCw className={busy === 'load' ? 'animate-spin' : ''} size={14} aria-hidden="true" />
            {t('common.refresh')}
          </Button>
        </div>
        {error && (
          <div
            className="mt-4 rounded-lg border border-error-border bg-error-subtle p-3 text-sm text-error"
            role="alert">
            {error}
          </div>
        )}
        {status && (
          <div
            className="mt-4 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
            role="status">
            {status}
          </div>
        )}
        <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="max-h-[34rem] space-y-1 overflow-auto rounded-xl border border-border p-2">
            {snapshot?.agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => selectAgent(agent)}
                className={`w-full rounded-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selectedId === agent.id ? 'bg-accent' : 'hover:bg-accent/50'
                }`}>
                <div className="truncate text-sm font-medium">{agent.title}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge variant="outline">{agent.origin.kind}</Badge>
                  <Badge variant="secondary">
                    {agent.provider}/{agent.model}
                  </Badge>
                </div>
              </button>
            ))}
            {!busy && snapshot?.agents.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">{tr('empty')}</div>
            )}
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => selectAgent()} disabled={Boolean(busy)}>
                <Plus size={14} aria-hidden="true" /> {tr('new')}
              </Button>
              <Button variant="outline" size="sm" onClick={duplicate} disabled={!selected || Boolean(busy)}>
                <FileJson size={14} aria-hidden="true" /> {tr('duplicate')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => importRef.current?.click()} disabled={Boolean(busy)}>
                {tr('importJson')}
              </Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => void importAgent(event.target.files?.[0])}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => selected && downloadJson(`${selected.id}.json`, selected.definition)}
                disabled={!selected}>
                <Download size={14} aria-hidden="true" /> {tr('exportJson')}
              </Button>
            </div>
            <label className="text-sm font-medium" htmlFor="uar-agent-definition">
              {tr('nativeDefinition')}
            </label>
            <Textarea.Input
              id="uar-agent-definition"
              rows={22}
              value={draft}
              onValueChange={setDraft}
              placeholder={tr('definitionPlaceholder')}
              disabled={Boolean(busy)}
              className="font-mono text-xs"
            />
            {selected && snapshot && (
              <UarAgentExecutionPanel
                agent={selected}
                catalog={snapshot}
                draft={draft}
                skillIds={draftSkillIds}
                busy={Boolean(busy)}
                onDraftChange={setDraft}
                onSkillIdsChange={setDraftSkillIds}
                onSave={saveAgent}
              />
            )}
            {selected && (
              <div className="break-all text-xs text-muted-foreground">
                {tr('revision')}: {selected.revision} · {tr('origin')}: {selected.origin.kind}/{selected.origin.id}
              </div>
            )}
            <div className="flex justify-end gap-2">
              {selected && (
                <Button variant="outline" onClick={() => void remove()} disabled={Boolean(busy)}>
                  <Trash2 size={14} aria-hidden="true" /> {t('common.delete')}
                </Button>
              )}
              <Button onClick={() => void saveAgent()} disabled={!draft.trim() || Boolean(busy)}>
                <Save size={14} aria-hidden="true" /> {busy === 'save' ? tr('saving') : t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      </SettingGroup>

      <SettingGroup>
        <SettingTitle>{tr('federationTitle')}</SettingTitle>
        <SettingDescription>{tr('federationDescription')}</SettingDescription>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Input
            aria-label="A2A ID"
            value={federatedId}
            onChange={(event) => setFederatedId(event.target.value)}
            placeholder="A2A ID"
          />
          <Input
            aria-label={tr('name')}
            value={federatedName}
            onChange={(event) => setFederatedName(event.target.value)}
            placeholder={tr('name')}
          />
          <Input
            aria-label={tr('baseUrl')}
            value={federatedUrl}
            onChange={(event) => setFederatedUrl(event.target.value)}
            placeholder={tr('baseUrl')}
          />
          <Input
            aria-label={tr('agentDescription')}
            value={federatedDescription}
            onChange={(event) => setFederatedDescription(event.target.value)}
            placeholder={tr('agentDescription')}
          />
          <Input
            aria-label={tr('capabilities')}
            value={federatedCapabilities}
            onChange={(event) => setFederatedCapabilities(event.target.value)}
            placeholder={tr('capabilities')}
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={() => void saveFederated()} disabled={Boolean(busy) || !federatedName || !federatedUrl}>
            {busy === 'federation' ? tr('registering') : tr('registerFederated')}
          </Button>
        </div>
        <div className="mt-4 divide-y divide-border-subtle rounded-xl border border-border">
          {snapshot?.federatedAgents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                setFederatedId(agent.id)
                setFederatedName(agent.name)
                setFederatedUrl(agent.baseUrl)
                setFederatedDescription(agent.description)
                setFederatedCapabilities(agent.capabilities.join(', '))
              }}
              className="flex w-full flex-wrap items-start justify-between gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <div>
                <div className="text-sm font-medium">{agent.name}</div>
                <div className="mt-1 break-all text-xs text-muted-foreground">{agent.baseUrl}</div>
              </div>
              <Badge variant="outline">{agent.capabilities.length}</Badge>
            </button>
          ))}
        </div>
      </SettingGroup>

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
        title={tr('dirtyTitle')}
        description={tr('dirtyDescription')}
        confirmText={tr('saveAndContinue')}
        cancelText={tr('continueEditing')}
        onConfirm={async () => {
          if (blocker.status !== 'blocked') return
          if (await saveAgent()) blocker.proceed()
        }}
        content={
          <Button
            variant="destructive"
            onClick={() => {
              if (blocker.status !== 'blocked') return
              if (selected) {
                setDraft(JSON.stringify(selected.definition, null, 2))
                setDraftSkillIds(selected.skillIds)
              } else {
                setDraft('')
                setDraftSkillIds([])
              }
              blocker.proceed()
            }}>
            {tr('discardAndContinue')}
          </Button>
        }
      />
      <ConfirmDialog
        open={pendingAgentId !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingAgentId(undefined)
        }}
        title={tr('dirtyTitle')}
        description={tr('dirtyDescription')}
        confirmText={tr('saveAndContinue')}
        cancelText={tr('continueEditing')}
        onConfirm={async () => {
          const nextId = pendingAgentId
          if (nextId === undefined || !(await saveAgent())) return
          setPendingAgentId(undefined)
          applyAgentSelection(nextId === '__new__' ? undefined : snapshot?.agents.find((agent) => agent.id === nextId))
        }}
        content={
          <Button
            variant="destructive"
            onClick={() => {
              const nextId = pendingAgentId
              setPendingAgentId(undefined)
              applyAgentSelection(
                nextId === '__new__' ? undefined : snapshot?.agents.find((agent) => agent.id === nextId)
              )
            }}>
            {tr('discardAndContinue')}
          </Button>
        }
      />
    </div>
  )
}
