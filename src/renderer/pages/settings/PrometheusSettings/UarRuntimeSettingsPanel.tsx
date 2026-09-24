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
import type { UarSettingState, UarSettingsNamespace, UarSettingsSnapshot } from '@shared/types/prometheusIntegration'

const NAMESPACES: UarSettingsNamespace[] = [
  'server',
  'security',
  'resilience',
  'persistence',
  'file-processing',
  'vision',
  'models',
  'knowledge-bases',
  'intent-classifier',
  'providers',
  'llm',
  'unstructured',
  'kreuzberg',
  'context-management',
  'context-strategy',
  'prompt-caching',
  'rag',
  'governance',
  'agent-config',
  'skill-config',
  'mistral-ocr',
  'memory',
  'llm-failover',
  'sandbox',
  'native-tools',
  'skill-evolution',
  'sycophancy',
  'acp'
]

function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value, null, 2)
}

function parsedValue(setting: UarSettingState, draft: string): unknown {
  if (typeof setting.saved === 'string') return draft
  if (typeof setting.saved === 'number') {
    const number = Number(draft)
    if (!Number.isFinite(number)) throw new Error('invalid-number')
    return number
  }
  return JSON.parse(draft)
}

function settingName(setting: UarSettingState): string {
  return setting.field.replaceAll('_', ' ').replaceAll('.', ' · ')
}

export function UarRuntimeSettingsPanel() {
  const { t } = useTranslation()
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`settings.prometheus.integration.uarAdmin.runtime.${key}`, options)
  const [namespace, setNamespace] = useState<UarSettingsNamespace>('server')
  const [snapshot, setSnapshot] = useState<UarSettingsSnapshot>()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (selected: UarSettingsNamespace) => {
    setBusy(true)
    setError(undefined)
    setStatus(undefined)
    setFieldErrors({})
    try {
      const next = await ipcApi.request('prometheus.uar.settings.read', { namespace: selected })
      setSnapshot(next)
      setDrafts(Object.fromEntries(next.settings.map((setting) => [setting.field, textValue(setting.saved)])))
      setDirty(new Set())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load(namespace)
  }, [load, namespace])

  const byField = useMemo(
    () => new Map(snapshot?.settings.map((setting) => [setting.field, setting]) ?? []),
    [snapshot]
  )

  const changeDraft = (field: string, value: string) => {
    setDrafts((current) => ({ ...current, [field]: value }))
    setDirty((current) => new Set(current).add(field))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
    setStatus(undefined)
  }

  const save = async () => {
    if (!snapshot || dirty.size === 0) return
    const invalid: Record<string, string> = {}
    const changes = [...dirty].flatMap((field) => {
      const setting = byField.get(field)
      if (!setting || setting.saved === '***') return []
      try {
        return [{ field, value: parsedValue(setting, drafts[field] ?? ''), expectedRevision: setting.revision }]
      } catch {
        invalid[field] = tr('invalidValue')
        return []
      }
    })
    if (Object.keys(invalid).length > 0) {
      setFieldErrors(invalid)
      return
    }
    if (changes.length === 0) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await ipcApi.request('prometheus.uar.settings.update', { namespace, changes })
      const next = await ipcApi.request('prometheus.uar.settings.read', { namespace })
      const errors = Object.fromEntries(
        result.errors.map((item) => [item.key.split('.').slice(1).join('.'), item.message ?? item.code])
      )
      setSnapshot(next)
      setDrafts(Object.fromEntries(next.settings.map((setting) => [setting.field, textValue(setting.saved)])))
      setDirty(new Set())
      setFieldErrors(errors)
      setStatus(result.status === 'updated' ? t('common.saved') : tr('partiallySaved'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingGroup>
      <SettingTitle>{tr('title')}</SettingTitle>
      <SettingDescription>{tr('description')}</SettingDescription>
      <div className="mt-5 grid gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="uar-settings-namespace">
            {tr('namespace')}
          </label>
          <Select value={namespace} onValueChange={(value) => setNamespace(value as UarSettingsNamespace)}>
            <SelectTrigger id="uar-settings-namespace" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NAMESPACES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item.replaceAll('-', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="rounded-lg border border-error-border bg-error-subtle p-3 text-sm text-error">{error}</div>
        )}
        {status && (
          <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">{status}</div>
        )}

        <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border">
          {snapshot?.settings.map((setting) => {
            const masked = setting.saved === '***'
            const value = drafts[setting.field] ?? ''
            return (
              <div key={setting.key} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium capitalize">{settingName(setting)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {setting.source} · {t(`settings.prometheus.integration.uarAdmin.apply.${setting.apply}`)}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {setting.drift && <Badge variant="outline">{tr('drift')}</Badge>}
                    <Badge variant="secondary">{tr(`status.${setting.applicationStatus}`)}</Badge>
                  </div>
                </div>

                {masked ? (
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    {tr('protectedValue')}
                  </div>
                ) : typeof setting.saved === 'boolean' ? (
                  <Switch
                    checked={value === 'true'}
                    onCheckedChange={(checked) => changeDraft(setting.field, String(checked))}
                    disabled={busy}
                  />
                ) : typeof setting.saved === 'object' ? (
                  <Textarea.Input
                    rows={5}
                    value={value}
                    onValueChange={(next) => changeDraft(setting.field, next)}
                    disabled={busy}
                    hasError={Boolean(fieldErrors[setting.field])}
                  />
                ) : (
                  <Input
                    type={typeof setting.saved === 'number' ? 'number' : 'text'}
                    value={value}
                    onChange={(event) => changeDraft(setting.field, event.target.value)}
                    disabled={busy}
                  />
                )}
                {fieldErrors[setting.field] && <div className="text-xs text-error">{fieldErrors[setting.field]}</div>}
                <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <span>{tr('savedValue', { value: textValue(setting.saved) })}</span>
                  <span>{tr('effectiveValue', { value: textValue(setting.effective) })}</span>
                </div>
              </div>
            )
          })}
          {!busy && snapshot?.settings.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">{tr('empty')}</div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => void load(namespace)} disabled={busy}>
            {t('settings.prometheus.integration.uarAdmin.retry')}
          </Button>
          <Button
            variant="outline"
            onClick={() => snapshot && void load(namespace)}
            disabled={busy || dirty.size === 0}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || dirty.size === 0}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </SettingGroup>
  )
}
