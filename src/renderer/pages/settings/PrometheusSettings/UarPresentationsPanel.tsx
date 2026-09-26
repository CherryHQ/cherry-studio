import { Eye, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { SettingDescription, SettingGroup, SettingTitle } from '@renderer/components/SettingsPrimitives'
import { ipcApi } from '@renderer/ipc'
import type {
  UarPresentation,
  UarPresentationAdministrationSnapshot,
  UarPresentationSelection,
  UarPresentationTemplate
} from '@shared/types/prometheusIntegration'

import { UarA2uiCatalogPanel } from './UarA2uiCatalogPanel'
import { UarPresentationPreview } from './UarPresentationPreview'

const DEFAULT_TEMPLATE: UarPresentationTemplate = {
  version: 'v0.9.1',
  catalog_id: 'urn:uar:a2ui:catalog:1',
  components: [{ id: 'root', component: 'Text', text: { path: '/message' } }],
  default_data: { message: 'Ready' }
}

export function UarPresentationsPanel() {
  const { t } = useTranslation()
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`settings.prometheus.integration.uarAdmin.presentations.${key}`, options)
  const [snapshot, setSnapshot] = useState<UarPresentationAdministrationSnapshot>()
  const [selected, setSelected] = useState<UarPresentation>()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [templateSource, setTemplateSource] = useState(JSON.stringify(DEFAULT_TEMPLATE, null, 2))
  const [selection, setSelection] = useState<UarPresentationSelection>({
    mode: 'inherit',
    ids: [],
    denied_ids: []
  })
  const [showPreview, setShowPreview] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [status, setStatus] = useState<string>()

  const load = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const next = await ipcApi.request('prometheus.uar.presentations.read', {})
      setSnapshot(next)
      setSelection(next.policy)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selectPresentation = (presentation?: UarPresentation) => {
    setSelected(presentation)
    setTitle(presentation?.title ?? '')
    setDescription(presentation?.description ?? '')
    setEnabled(presentation?.enabled ?? true)
    setTemplateSource(JSON.stringify(presentation?.template ?? DEFAULT_TEMPLATE, null, 2))
    setError(undefined)
    setStatus(undefined)
  }

  const template = useMemo(() => {
    try {
      return JSON.parse(templateSource) as UarPresentationTemplate
    } catch {
      return undefined
    }
  }, [templateSource])

  const savePresentation = async () => {
    if (!template) {
      setError(tr('invalidTemplate'))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const next = await ipcApi.request('prometheus.uar.presentations.save', {
        ...(selected ? { id: selected.id, expectedRevision: selected.revision } : {}),
        title: title.trim(),
        description: description.trim(),
        enabled,
        template: template as unknown as Record<string, unknown>
      })
      setSnapshot(next)
      const saved = selected
        ? next.presentations.find((presentation) => presentation.id === selected.id)
        : next.presentations.find((presentation) => presentation.title === title.trim())
      selectPresentation(saved)
      setStatus(tr('saved'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusy(false)
    }
  }

  const removePresentation = async () => {
    if (!selected || !window.confirm(tr('deletePresentationConfirm', { id: selected.title }))) return
    setBusy(true)
    setError(undefined)
    try {
      const next = await ipcApi.request('prometheus.uar.presentations.delete', {
        id: selected.id,
        expectedRevision: selected.revision
      })
      setSnapshot(next)
      setSelection(next.policy)
      selectPresentation()
      setStatus(tr('deleted'))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    } finally {
      setBusy(false)
    }
  }

  const toggleSelection = (id: string, field: 'ids' | 'denied_ids') => {
    setSelection((current) => ({
      ...current,
      [field]: current[field].includes(id) ? current[field].filter((value) => value !== id) : [...current[field], id],
      [field === 'ids' ? 'denied_ids' : 'ids']: current[field].includes(id)
        ? current[field === 'ids' ? 'denied_ids' : 'ids']
        : current[field === 'ids' ? 'denied_ids' : 'ids'].filter((value) => value !== id)
    }))
  }

  const savePolicy = async () => {
    if (!snapshot) return
    setBusy(true)
    setError(undefined)
    try {
      const next = await ipcApi.request('prometheus.uar.presentations.save_policy', {
        expectedPolicy: snapshot.policyBaseline,
        selection
      })
      setSnapshot(next)
      setSelection(next.policy)
      setStatus(tr('policySaved'))
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : String(policyError))
    } finally {
      setBusy(false)
    }
  }

  if (!snapshot && busy) {
    return <div className="py-12 text-center text-sm text-muted-foreground">{tr('loading')}</div>
  }
  if (!snapshot) {
    return (
      <SettingGroup>
        <SettingTitle>{tr('loadFailed')}</SettingTitle>
        <SettingDescription>{error ?? tr('loadFailedDescription')}</SettingDescription>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          {tr('retry')}
        </Button>
      </SettingGroup>
    )
  }

  return (
    <div className="space-y-5" aria-busy={busy}>
      <SettingGroup>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SettingTitle>{tr('title')}</SettingTitle>
            <SettingDescription>{tr('description')}</SettingDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={14} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
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
          <div className="max-h-[38rem] space-y-1 overflow-auto rounded-xl border border-border p-2">
            <Button
              variant="outline"
              size="sm"
              className="mb-2 w-full"
              onClick={() => selectPresentation()}
              disabled={busy}>
              <Plus size={14} aria-hidden="true" /> {tr('newPresentation')}
            </Button>
            {snapshot.presentations.map((presentation) => (
              <button
                key={presentation.id}
                type="button"
                onClick={() => selectPresentation(presentation)}
                aria-pressed={selected?.id === presentation.id}
                className={`w-full rounded-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === presentation.id ? 'bg-accent' : 'hover:bg-accent/50'}`}>
                <span className="block truncate text-sm font-medium">{presentation.title}</span>
                <span className="mt-1 flex gap-1">
                  <Badge variant="outline">r{presentation.revision}</Badge>
                  <Badge variant={presentation.enabled ? 'secondary' : 'outline'}>
                    {presentation.enabled ? tr('enabled') : tr('disabled')}
                  </Badge>
                </span>
              </button>
            ))}
            {snapshot.presentations.length === 0 && <p className="p-3 text-sm text-muted-foreground">{tr('empty')}</p>}
          </div>
          <div className="min-w-0 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={tr('presentationTitle')}
                aria-label={tr('presentationTitle')}
                disabled={busy}
              />
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={tr('descriptionLabel')}
                aria-label={tr('descriptionLabel')}
                disabled={busy}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <div>
                <div className="text-sm font-medium">{tr('availableToRuns')}</div>
                <div className="text-xs text-muted-foreground">{tr('availableToRunsDescription')}</div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={busy} />
            </div>
            <Textarea.Input
              rows={16}
              value={templateSource}
              onValueChange={setTemplateSource}
              className="font-mono text-xs"
              aria-label={tr('templateSource')}
              disabled={busy}
            />
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => setShowPreview((value) => !value)} disabled={!template}>
                <Eye size={14} aria-hidden="true" />
                {showPreview ? tr('hidePreview') : tr('showPreview')}
              </Button>
              <div className="flex gap-2">
                {selected && (
                  <Button variant="destructive" onClick={() => void removePresentation()} disabled={busy}>
                    <Trash2 size={14} aria-hidden="true" />
                    {t('common.delete')}
                  </Button>
                )}
                <Button onClick={() => void savePresentation()} disabled={busy || !title.trim() || !template}>
                  <Save size={14} aria-hidden="true" />
                  {t('common.save')}
                </Button>
              </div>
            </div>
            {showPreview && template && <UarPresentationPreview template={template} />}
          </div>
        </div>
      </SettingGroup>

      <SettingGroup>
        <SettingTitle>{tr('assignmentTitle')}</SettingTitle>
        <SettingDescription>{tr('assignmentDescription')}</SettingDescription>
        <div className="mt-4 max-w-sm">
          <Select
            value={selection.mode}
            onValueChange={(mode) =>
              setSelection((current) => ({ ...current, mode: mode as UarPresentationSelection['mode'] }))
            }
            disabled={busy}>
            <SelectTrigger aria-label={tr('selectionMode')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['inherit', 'auto', 'all', 'selected', 'none'].map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {tr(`mode.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-4 divide-y divide-border-subtle rounded-xl border border-border">
          {snapshot.presentations.map((presentation) => (
            <div key={presentation.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <div className="text-sm font-medium">{presentation.title}</div>
                <div className="text-xs text-muted-foreground">{presentation.id}</div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={selection.ids.includes(presentation.id)}
                    onCheckedChange={() => toggleSelection(presentation.id, 'ids')}
                    disabled={busy || selection.mode !== 'selected'}
                  />
                  {tr('selected')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={selection.denied_ids.includes(presentation.id)}
                    onCheckedChange={() => toggleSelection(presentation.id, 'denied_ids')}
                    disabled={busy}
                  />
                  {tr('denied')}
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => void savePolicy()} disabled={busy}>
            <Save size={14} aria-hidden="true" />
            {tr('saveAssignments')}
          </Button>
        </div>
      </SettingGroup>

      <SettingGroup>
        <SettingTitle>{tr('catalogTitle')}</SettingTitle>
        <SettingDescription>{tr('catalogDescription')}</SettingDescription>
        <div className="mt-5">
          <UarA2uiCatalogPanel
            snapshot={snapshot}
            busy={busy}
            setBusy={setBusy}
            setSnapshot={setSnapshot}
            feedback={{ error: setError, status: setStatus }}
          />
        </div>
      </SettingGroup>
    </div>
  )
}
