import { Button, InputGroup, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import { useCopilot } from '@renderer/hooks/useCopilot'
import { useProvider } from '@renderer/hooks/useProviders'
import { cn, validateApiHost } from '@renderer/utils'
import { trim } from 'lodash'
import { Plus, Settings, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderActions from '../primitives/ProviderActions'
import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { customHeaderDrawerClasses, drawerClasses, fieldClasses } from '../primitives/ProviderSettingsPrimitives'
import { applyProviderCustomHeaderSideEffects } from '../utils/providerSettingsSideEffects'

interface ProviderCustomHeaderDrawerProps {
  providerId: string
  open: boolean
  onClose: () => void
  hostEditMode: 'primary' | 'anthropic'
  apiHost: string
  anthropicApiHost: string
  commitApiHost: (explicitNext?: string) => Promise<boolean>
  commitAnthropicApiHost: (explicitNext?: string) => Promise<boolean>
  isVertexProvider: boolean
}

interface HeaderRow {
  id: string
  key: string
  value: string
}

type HeadersUiMode = 'list' | 'json'

function newRow(partial?: Partial<Pick<HeaderRow, 'key' | 'value'>>): HeaderRow {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return { id, key: partial?.key ?? '', value: partial?.value ?? '' }
}

function headersObjectToRows(obj: Record<string, string>): HeaderRow[] {
  const entries = Object.entries(obj)
  if (entries.length === 0) {
    return []
  }
  return entries.map(([key, value]) => newRow({ key, value }))
}

function rowsToHeadersObject(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const k = row.key.trim()
    if (!k) {
      continue
    }
    out[k] = row.value
  }
  return out
}

/** Parse JSON object for custom headers; primitive values coerced to strings. */
function parseHeadersJsonDraft(raw: string): { ok: true; headers: Record<string, string> } | { ok: false } {
  const t = trim(raw)
  if (t === '') {
    return { ok: true, headers: {} }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(t) as unknown
  } catch {
    return { ok: false }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false }
  }
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    const kk = trim(key)
    if (!kk) {
      continue
    }
    if (val !== null && typeof val === 'object') {
      return { ok: false }
    }
    out[kk] = val === null || val === undefined ? '' : String(val)
  }
  return { ok: true, headers: out }
}

export default function ProviderCustomHeaderDrawer({
  providerId,
  open,
  onClose,
  hostEditMode,
  apiHost,
  anthropicApiHost,
  commitApiHost,
  commitAnthropicApiHost,
  isVertexProvider
}: ProviderCustomHeaderDrawerProps) {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const { defaultHeaders, updateDefaultHeaders } = useCopilot()

  const sourceHeaders = useMemo<Record<string, string>>(
    () => (providerId === 'copilot' ? { ...defaultHeaders } : { ...provider?.settings?.extraHeaders }),
    [defaultHeaders, provider?.settings?.extraHeaders, providerId]
  )

  const [rows, setRows] = useState<HeaderRow[]>([])
  const [draftHost, setDraftHost] = useState('')
  const [headersUiMode, setHeadersUiMode] = useState<HeadersUiMode>('list')
  const [jsonDraft, setJsonDraft] = useState('')
  const wasOpenRef = useRef(false)

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current
    wasOpenRef.current = open

    if (!justOpened) {
      return
    }

    setRows(headersObjectToRows(sourceHeaders))
    setJsonDraft(JSON.stringify(sourceHeaders, null, 2))
    setHeadersUiMode('list')
    setDraftHost(trim(hostEditMode === 'anthropic' ? anthropicApiHost : apiHost))
  }, [open, sourceHeaders, hostEditMode, anthropicApiHost, apiHost])

  const syncListToJson = useCallback(() => {
    setJsonDraft(JSON.stringify(rowsToHeadersObject(rows), null, 2))
  }, [rows])

  const applyJsonToRowsOrToast = useCallback((): boolean => {
    const parsed = parseHeadersJsonDraft(jsonDraft)
    if (!parsed.ok) {
      window.toast.error(t('settings.provider.copilot.invalid_json'))
      return false
    }
    setRows(headersObjectToRows(parsed.headers))
    return true
  }, [jsonDraft, t])

  const toggleHeadersUiMode = useCallback(() => {
    if (headersUiMode === 'list') {
      syncListToJson()
      setHeadersUiMode('json')
      return
    }
    if (!applyJsonToRowsOrToast()) {
      return
    }
    setHeadersUiMode('list')
  }, [applyJsonToRowsOrToast, headersUiMode, syncListToJson])

  const handleSave = useCallback(async () => {
    const trimmed = trim(draftHost)
    let hostSaved: boolean
    if (hostEditMode === 'primary') {
      if (!validateApiHost(trimmed) || (!isVertexProvider && !trimmed)) {
        window.toast.error(t('settings.provider.api_host_no_valid'))
        return
      }
      hostSaved = await commitApiHost(trimmed)
    } else {
      hostSaved = await commitAnthropicApiHost(trimmed)
    }

    if (!hostSaved) {
      return
    }

    let parsedHeaders: Record<string, string>
    if (headersUiMode === 'json') {
      const parsed = parseHeadersJsonDraft(jsonDraft)
      if (!parsed.ok) {
        window.toast.error(t('settings.provider.copilot.invalid_json'))
        return
      }
      parsedHeaders = parsed.headers
    } else {
      parsedHeaders = rowsToHeadersObject(rows)
    }

    applyProviderCustomHeaderSideEffects({
      providerId,
      headers: parsedHeaders,
      updateCopilotHeaders: updateDefaultHeaders
    })

    await updateProvider({ providerSettings: { ...provider?.settings, extraHeaders: parsedHeaders } })

    window.toast.success(t('message.save.success.title'))
    onClose()
  }, [
    commitAnthropicApiHost,
    commitApiHost,
    draftHost,
    headersUiMode,
    hostEditMode,
    isVertexProvider,
    jsonDraft,
    onClose,
    provider?.settings,
    providerId,
    rows,
    t,
    updateDefaultHeaders,
    updateProvider
  ])

  const footer = (
    <ProviderActions className={drawerClasses.footer}>
      <Button type="button" variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button type="button" onClick={() => void handleSave()}>
        {t('common.save')}
      </Button>
    </ProviderActions>
  )

  const hostLabel =
    hostEditMode === 'anthropic'
      ? t('settings.provider.anthropic_api_host')
      : `${t('settings.provider.api_host')} (Endpoint URL)`

  const toggleLabel =
    headersUiMode === 'list'
      ? t('settings.provider.copilot.toggle_headers_editor_json')
      : t('settings.provider.copilot.toggle_headers_editor_list')

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('settings.provider.request_configuration')}
      footer={footer}
      size="form">
      <div className={customHeaderDrawerClasses.bodyScroll}>
        <div className="space-y-1.5">
          <label className="font-medium text-muted-foreground/60 text-xs" htmlFor="provider-request-config-host">
            {hostLabel}
          </label>
          <InputGroup className={fieldClasses.inputGroup}>
            <InputGroupInput
              id="provider-request-config-host"
              className={fieldClasses.input}
              value={draftHost}
              placeholder={t('settings.provider.api_host')}
              onChange={(e) => {
                setDraftHost(e.target.value)
              }}
              autoComplete="off"
            />
          </InputGroup>
          <p className="break-words text-muted-foreground/40 text-xs leading-relaxed">
            {t('settings.provider.api_host_drawer_hint')}
          </p>
        </div>

        <div className="space-y-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-muted-foreground/60 text-xs">
              {t('settings.provider.copilot.custom_headers')}
            </span>
            <Tooltip content={toggleLabel}>
              <button
                type="button"
                aria-label={toggleLabel}
                className={cn(fieldClasses.iconButton, 'shrink-0')}
                onClick={toggleHeadersUiMode}>
                <Settings className="size-3" aria-hidden />
              </button>
            </Tooltip>
          </div>

          {headersUiMode === 'list' ? (
            <>
              {rows.map((row) => (
                <div key={row.id} className={customHeaderDrawerClasses.card}>
                  <div className={customHeaderDrawerClasses.cardRow}>
                    <label className={customHeaderDrawerClasses.cardRowLabel} htmlFor={`provider-hdr-key-${row.id}`}>
                      {t('settings.provider.copilot.header_field_name')}
                    </label>
                    <input
                      id={`provider-hdr-key-${row.id}`}
                      className={customHeaderDrawerClasses.cardInput}
                      value={row.key}
                      onChange={(e) => {
                        const v = e.target.value
                        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, key: v } : r)))
                      }}
                      placeholder={t('settings.provider.copilot.header_name_placeholder')}
                      autoComplete="off"
                    />
                  </div>
                  <div className={customHeaderDrawerClasses.cardRow}>
                    <label className={customHeaderDrawerClasses.cardRowLabel} htmlFor={`provider-hdr-val-${row.id}`}>
                      {t('settings.provider.copilot.header_field_value')}
                    </label>
                    <input
                      id={`provider-hdr-val-${row.id}`}
                      className={customHeaderDrawerClasses.cardInput}
                      value={row.value}
                      onChange={(e) => {
                        const v = e.target.value
                        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, value: v } : r)))
                      }}
                      placeholder={t('settings.provider.copilot.header_value_placeholder')}
                      autoComplete="off"
                    />
                  </div>
                  <div className={customHeaderDrawerClasses.cardRemoveRow}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={customHeaderDrawerClasses.removeIconButton}
                      onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                      aria-label={t('common.delete')}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                className={customHeaderDrawerClasses.addRowButton}
                onClick={() => setRows((prev) => [...prev, newRow()])}>
                <Plus className="size-2.5 shrink-0" aria-hidden />
                <span>{t('settings.provider.copilot.add_request_header')}</span>
              </Button>
            </>
          ) : (
            <div className="space-y-1.5">
              <textarea
                value={jsonDraft}
                onChange={(e) => {
                  setJsonDraft(e.target.value)
                }}
                spellCheck={false}
                autoComplete="off"
                rows={8}
                aria-label={t('settings.provider.copilot.custom_headers')}
                placeholder={t('settings.provider.copilot.headers_json_placeholder')}
                className={customHeaderDrawerClasses.headersJsonEditor}
              />
              <p className="text-muted-foreground/40 text-xs leading-relaxed">
                {t('settings.provider.copilot.headers_description')}
              </p>
            </div>
          )}
        </div>
      </div>
    </ProviderSettingsDrawer>
  )
}
