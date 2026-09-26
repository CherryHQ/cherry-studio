import { Plus, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
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
  Textarea
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type {
  UarA2uiComponent,
  UarArtifactSchema,
  UarPresentationAdministrationSnapshot
} from '@shared/types/prometheusIntegration'

type Feedback = { error: (message?: string) => void; status: (message?: string) => void }

export function UarA2uiCatalogPanel({
  snapshot,
  busy,
  setBusy,
  setSnapshot,
  feedback
}: {
  snapshot: UarPresentationAdministrationSnapshot
  busy: boolean
  setBusy: (value: boolean) => void
  setSnapshot: (value: UarPresentationAdministrationSnapshot) => void
  feedback: Feedback
}) {
  const { t } = useTranslation()
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`settings.prometheus.integration.uarAdmin.presentations.${key}`, options)
  const [schemaId, setSchemaId] = useState('')
  const [schemaTitle, setSchemaTitle] = useState('')
  const [schemaDescription, setSchemaDescription] = useState('')
  const [artifactType, setArtifactType] = useState<UarArtifactSchema['artifactType']>('display')
  const [renderHint, setRenderHint] = useState('inline')
  const [schemaJson, setSchemaJson] = useState('{\n  "type": "object"\n}')
  const [selectedSchema, setSelectedSchema] = useState<UarArtifactSchema>()
  const [selectedComponent, setSelectedComponent] = useState<UarA2uiComponent>()
  const [componentTitle, setComponentTitle] = useState('')
  const [componentDescription, setComponentDescription] = useState('')
  const [componentSource, setComponentSource] = useState('')

  const selectSchema = (schema?: UarArtifactSchema) => {
    setSelectedSchema(schema)
    setSchemaId(schema?.schemaId ?? '')
    setSchemaTitle(schema?.title ?? '')
    setSchemaDescription(schema?.description ?? '')
    setArtifactType(schema?.artifactType ?? 'display')
    setRenderHint(schema?.renderHint ?? 'inline')
    setSchemaJson(JSON.stringify(schema?.jsonSchema ?? { type: 'object' }, null, 2))
    feedback.error()
    feedback.status()
  }

  const selectComponent = (component?: UarA2uiComponent) => {
    setSelectedComponent(component)
    setComponentTitle(component?.title ?? '')
    setComponentDescription(component?.description ?? '')
    setComponentSource(component?.source ?? '')
    feedback.error()
    feedback.status()
  }

  const saveSchema = async () => {
    setBusy(true)
    feedback.error()
    try {
      const next = await ipcApi.request('prometheus.uar.presentations.save_schema', {
        mode: selectedSchema ? 'update' : 'create',
        schemaId: schemaId.trim(),
        ...(selectedSchema?.revision ? { expectedRevision: selectedSchema.revision } : {}),
        title: schemaTitle.trim(),
        description: schemaDescription.trim(),
        artifactType,
        jsonSchema: JSON.parse(schemaJson) as Record<string, unknown>,
        ...(renderHint.trim() ? { renderHint: renderHint.trim() } : {})
      })
      setSnapshot(next)
      selectSchema(next.schemas.find((schema) => schema.schemaId === schemaId.trim()))
      feedback.status(tr('schemaSaved'))
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const removeSchema = async () => {
    if (!selectedSchema?.revision || !window.confirm(tr('deleteSchemaConfirm', { id: selectedSchema.schemaId }))) return
    setBusy(true)
    feedback.error()
    try {
      setSnapshot(
        await ipcApi.request('prometheus.uar.presentations.delete_schema', {
          schemaId: selectedSchema.schemaId,
          expectedRevision: selectedSchema.revision
        })
      )
      selectSchema()
      feedback.status(tr('schemaDeleted'))
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const saveComponent = async () => {
    setBusy(true)
    feedback.error()
    try {
      const current = selectedComponent?.builtin ? undefined : selectedComponent
      const next = await ipcApi.request('prometheus.uar.presentations.save_component', {
        ...(current ? { id: current.id, expectedRevision: current.revision } : {}),
        title: componentTitle.trim(),
        ...(componentDescription.trim() ? { description: componentDescription.trim() } : {}),
        source: componentSource
      })
      setSnapshot(next)
      const saved = next.components.find((component) => !component.builtin && component.title === componentTitle.trim())
      selectComponent(saved)
      feedback.status(tr('componentSaved'))
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const removeComponent = async () => {
    const current = selectedComponent
    if (!current || current.builtin || !window.confirm(tr('deleteComponentConfirm', { id: current.title }))) return
    setBusy(true)
    feedback.error()
    try {
      setSnapshot(
        await ipcApi.request('prometheus.uar.presentations.delete_component', {
          id: current.id,
          expectedRevision: current.revision
        })
      )
      selectComponent()
      feedback.status(tr('componentDeleted'))
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="uar-schema-catalog-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="uar-schema-catalog-heading" className="font-medium">
              {tr('schemasTitle')}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{tr('schemasDescription')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => selectSchema()} disabled={busy}>
            <Plus size={14} aria-hidden="true" /> {tr('newSchema')}
          </Button>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="max-h-80 space-y-1 overflow-auto rounded-xl border border-border p-2">
            {snapshot.schemas.map((schema) => (
              <button
                key={schema.schemaId}
                type="button"
                onClick={() => selectSchema(schema)}
                aria-pressed={selectedSchema?.schemaId === schema.schemaId}
                className={`w-full rounded-lg p-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedSchema?.schemaId === schema.schemaId ? 'bg-accent' : 'hover:bg-accent/50'}`}>
                <span className="block truncate font-medium">{schema.title}</span>
                <span className="mt-1 flex gap-1">
                  <Badge variant="outline">{schema.artifactType}</Badge>
                  {schema.builtin && <Badge variant="secondary">{tr('builtin')}</Badge>}
                </span>
              </button>
            ))}
          </div>
          <div className="min-w-0 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={schemaId}
                onChange={(event) => setSchemaId(event.target.value)}
                placeholder={tr('schemaId')}
                aria-label={tr('schemaId')}
                disabled={busy || selectedSchema?.builtin}
              />
              <Input
                value={schemaTitle}
                onChange={(event) => setSchemaTitle(event.target.value)}
                placeholder={tr('schemaTitle')}
                aria-label={tr('schemaTitle')}
                disabled={busy || selectedSchema?.builtin}
              />
            </div>
            <Input
              value={schemaDescription}
              onChange={(event) => setSchemaDescription(event.target.value)}
              placeholder={tr('descriptionLabel')}
              aria-label={tr('descriptionLabel')}
              disabled={busy || selectedSchema?.builtin}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                value={artifactType}
                onValueChange={(value) => setArtifactType(value as UarArtifactSchema['artifactType'])}
                disabled={busy || selectedSchema?.builtin}>
                <SelectTrigger aria-label={tr('artifactType')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['form', 'confirm', 'select', 'text_input', 'display', 'chart', 'media'].map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={renderHint}
                onChange={(event) => setRenderHint(event.target.value)}
                placeholder={tr('renderHint')}
                aria-label={tr('renderHint')}
                disabled={busy || selectedSchema?.builtin}
              />
            </div>
            <Textarea.Input
              rows={8}
              value={schemaJson}
              onValueChange={setSchemaJson}
              className="font-mono text-xs"
              aria-label={tr('jsonSchema')}
              disabled={busy || selectedSchema?.builtin}
            />
            {selectedSchema?.builtin ? (
              <p className="text-sm text-muted-foreground">{tr('builtinReadOnly')}</p>
            ) : (
              <div className="flex justify-end gap-2">
                {selectedSchema && (
                  <Button variant="destructive" onClick={() => void removeSchema()} disabled={busy}>
                    <Trash2 size={14} aria-hidden="true" />
                    {t('common.delete')}
                  </Button>
                )}
                <Button onClick={() => void saveSchema()} disabled={busy || !schemaId.trim() || !schemaTitle.trim()}>
                  <Save size={14} aria-hidden="true" />
                  {t('common.save')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-border pt-6" aria-labelledby="uar-component-catalog-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="uar-component-catalog-heading" className="font-medium">
              {tr('componentsTitle')}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{tr('componentsDescription')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => selectComponent()} disabled={busy}>
            <Plus size={14} aria-hidden="true" />
            {tr('newComponent')}
          </Button>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="max-h-80 space-y-1 overflow-auto rounded-xl border border-border p-2">
            {snapshot.components.map((component) => (
              <button
                key={`${component.builtin}-${component.id}`}
                type="button"
                onClick={() => selectComponent(component)}
                aria-pressed={selectedComponent?.id === component.id}
                className={`w-full rounded-lg p-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedComponent?.id === component.id ? 'bg-accent' : 'hover:bg-accent/50'}`}>
                <span className="block truncate font-medium">{component.title}</span>
                <span className="mt-1 flex gap-1">
                  <Badge variant="outline">{component.category}</Badge>
                  {component.builtin && <Badge variant="secondary">{tr('builtin')}</Badge>}
                </span>
              </button>
            ))}
          </div>
          <div className="min-w-0 space-y-3">
            <Input
              value={componentTitle}
              onChange={(event) => setComponentTitle(event.target.value)}
              placeholder={tr('componentTitle')}
              aria-label={tr('componentTitle')}
              disabled={busy || selectedComponent?.builtin}
            />
            <Input
              value={componentDescription}
              onChange={(event) => setComponentDescription(event.target.value)}
              placeholder={tr('descriptionLabel')}
              aria-label={tr('descriptionLabel')}
              disabled={busy || selectedComponent?.builtin}
            />
            <Textarea.Input
              rows={10}
              value={componentSource}
              onValueChange={setComponentSource}
              className="font-mono text-xs"
              placeholder={tr('componentSource')}
              disabled={busy || selectedComponent?.builtin}
            />
            {selectedComponent?.builtin ? (
              <p className="text-sm text-muted-foreground">{tr('builtinReadOnly')}</p>
            ) : (
              <div className="flex justify-end gap-2">
                {selectedComponent && (
                  <Button variant="destructive" onClick={() => void removeComponent()} disabled={busy}>
                    <Trash2 size={14} aria-hidden="true" />
                    {t('common.delete')}
                  </Button>
                )}
                <Button
                  onClick={() => void saveComponent()}
                  disabled={busy || !componentTitle.trim() || !componentSource.trim()}>
                  <Save size={14} aria-hidden="true" />
                  {t('common.save')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
