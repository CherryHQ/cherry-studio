import {
  Button,
  InputGroup,
  InputGroupInput,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { useCopilot } from '@renderer/hooks/useCopilot'
import { useProvider } from '@renderer/hooks/useProviders'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettings/utils/providerTopology'
import { cn, validateApiHost } from '@renderer/utils'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { EndpointConfig } from '@shared/data/types/provider'
import { trim } from 'lodash'
import { Plus, Settings, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'

import { useProviderModelSync } from '../hooks/useProviderModelSync'
import ProviderActions from '../primitives/ProviderActions'
import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { customHeaderDrawerClasses, drawerClasses, fieldClasses } from '../primitives/ProviderSettingsPrimitives'
import { applyProviderCustomHeaderSideEffects } from '../utils/providerSettingsSideEffects'

interface ProviderCustomHeaderDrawerProps {
  providerId: string
  open: boolean
  onClose: () => void
}

interface HeaderRow {
  id: string
  key: string
  value: string
}

type HeadersUiMode = 'list' | 'json'

const ENDPOINT_TYPE_LABEL_KEYS: Partial<Record<EndpointType, string>> = {
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: 'settings.provider.more_endpoints.openai_chat',
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: 'settings.provider.more_endpoints.anthropic',
  [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: 'settings.provider.more_endpoints.gemini',
  [ENDPOINT_TYPE.OPENAI_RESPONSES]: 'settings.provider.more_endpoints.openai_responses'
}

function newRow(partial?: Partial<Pick<HeaderRow, 'key' | 'value'>>): HeaderRow {
  return { id: uuidv4(), key: partial?.key ?? '', value: partial?.value ?? '' }
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

/** Compute the ordered list of endpoint types the form should expose. */
function resolveEndpointTypes(
  provider: { endpointConfigs?: Partial<Record<EndpointType, EndpointConfig>> } | null | undefined,
  primary: EndpointType
): EndpointType[] {
  const configured = Object.keys(provider?.endpointConfigs ?? {}) as EndpointType[]
  const others = configured.filter((type) => type !== primary).sort()
  return [primary, ...others]
}

/**
 * Merge a per-endpoint baseUrl drafts map back into a full endpointConfigs
 * object. Preserves any non-baseUrl fields (reasoningFormatType, modelsApiUrls)
 * that were already configured. Empty drafts for non-primary endpoints remove
 * the entry entirely so the configs map stays clean.
 */
function mergeEndpointConfigs(
  existing: Partial<Record<EndpointType, EndpointConfig>> | undefined,
  drafts: Record<string, string>,
  primary: EndpointType
): Partial<Record<EndpointType, EndpointConfig>> {
  const out: Partial<Record<EndpointType, EndpointConfig>> = { ...(existing ?? {}) }
  for (const [type, raw] of Object.entries(drafts) as [EndpointType, string][]) {
    const value = trim(raw)
    if (value) {
      out[type] = { ...out[type], baseUrl: value }
    } else if (type === primary) {
      const rest = { ...out[type] }
      delete rest.baseUrl
      if (Object.keys(rest).length > 0) {
        out[type] = rest
      } else {
        delete out[type]
      }
    } else {
      delete out[type]
    }
  }
  return out
}

export default function ProviderCustomHeaderDrawer({ providerId, open, onClose }: ProviderCustomHeaderDrawerProps) {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const { defaultHeaders, updateDefaultHeaders } = useCopilot()
  const { syncProviderModels } = useProviderModelSync(providerId)

  const topology = getProviderHostTopology(provider)
  const primaryEndpoint = topology.primaryEndpoint
  const endpointTypes = useMemo(() => resolveEndpointTypes(provider, primaryEndpoint), [provider, primaryEndpoint])

  const sourceHeaders = useMemo<Record<string, string>>(
    () => (providerId === 'copilot' ? { ...defaultHeaders } : { ...provider?.settings?.extraHeaders }),
    [defaultHeaders, provider?.settings?.extraHeaders, providerId]
  )

  const [rows, setRows] = useState<HeaderRow[]>([])
  const [endpointDrafts, setEndpointDrafts] = useState<Record<string, string>>({})
  const [visibleEndpointTypes, setVisibleEndpointTypes] = useState<EndpointType[]>([])
  const [addEndpointOpen, setAddEndpointOpen] = useState(false)
  const [headersUiMode, setHeadersUiMode] = useState<HeadersUiMode>('list')
  const [jsonDraft, setJsonDraft] = useState('')
  const wasOpenRef = useRef(false)

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current
    wasOpenRef.current = open

    if (!justOpened) {
      return
    }

    const drafts: Record<string, string> = {}
    for (const type of endpointTypes) {
      drafts[type] = trim(provider?.endpointConfigs?.[type]?.baseUrl ?? '')
    }
    setEndpointDrafts(drafts)
    setVisibleEndpointTypes(endpointTypes)
    setAddEndpointOpen(false)
    setRows(headersObjectToRows(sourceHeaders))
    setJsonDraft(JSON.stringify(sourceHeaders, null, 2))
    setHeadersUiMode('list')
  }, [open, sourceHeaders, endpointTypes, provider?.endpointConfigs])

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
    if (!provider) return

    // Validate the primary baseUrl — non-empty + URL-shape, unless this is
    // Vertex (whose primary endpoint is account-managed, no URL needed).
    const primaryDraft = trim(endpointDrafts[primaryEndpoint] ?? '')
    const isVertex = provider.authType === 'iam-gcp'
    if (!isVertex && (!primaryDraft || !validateApiHost(primaryDraft))) {
      window.toast.error(t('settings.provider.api_host_no_valid'))
      return
    }

    const nextEndpointConfigs = mergeEndpointConfigs(provider.endpointConfigs, endpointDrafts, primaryEndpoint)
    const previousPrimaryBaseUrl = trim(provider.endpointConfigs?.[primaryEndpoint]?.baseUrl ?? '')

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

    await updateProvider({
      endpointConfigs: nextEndpointConfigs,
      providerSettings: { ...provider.settings, extraHeaders: parsedHeaders }
    })

    if (primaryDraft !== previousPrimaryBaseUrl) {
      void syncProviderModels({ ...provider, endpointConfigs: nextEndpointConfigs })
    }

    window.toast.success(t('message.save.success.title'))
    onClose()
  }, [
    endpointDrafts,
    headersUiMode,
    jsonDraft,
    onClose,
    primaryEndpoint,
    provider,
    providerId,
    rows,
    syncProviderModels,
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

  const toggleLabel =
    headersUiMode === 'list'
      ? t('settings.provider.copilot.toggle_headers_editor_json')
      : t('settings.provider.copilot.toggle_headers_editor_list')

  /** Known endpoint types the user can still add (not currently shown). */
  const addableEndpointTypes = (Object.keys(ENDPOINT_TYPE_LABEL_KEYS) as EndpointType[]).filter(
    (type) => !visibleEndpointTypes.includes(type)
  )

  const handleAddEndpoint = (type: EndpointType) => {
    setVisibleEndpointTypes((prev) => (prev.includes(type) ? prev : [...prev, type]))
    setEndpointDrafts((prev) => ({ ...prev, [type]: prev[type] ?? '' }))
    setAddEndpointOpen(false)
  }

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('settings.provider.request_configuration')}
      footer={footer}
      size="form">
      <div className={customHeaderDrawerClasses.bodyScroll}>
        {visibleEndpointTypes.map((type, index) => {
          const isPrimary = index === 0
          const labelKey = ENDPOINT_TYPE_LABEL_KEYS[type]
          const label = isPrimary ? `${t('settings.provider.api_host')} (Endpoint URL)` : labelKey ? t(labelKey) : type
          const inputId = `provider-request-config-endpoint-${type}`
          return (
            <div key={type} className="space-y-1.5">
              <label className="font-medium text-muted-foreground/60 text-xs" htmlFor={inputId}>
                {label}
              </label>
              <InputGroup className={fieldClasses.inputGroup}>
                <InputGroupInput
                  id={inputId}
                  className={fieldClasses.input}
                  value={endpointDrafts[type] ?? ''}
                  placeholder={t('settings.provider.api_host')}
                  onChange={(e) => setEndpointDrafts((prev) => ({ ...prev, [type]: e.target.value }))}
                  autoComplete="off"
                />
              </InputGroup>
              {isPrimary && (
                <p className="wrap-break-word text-muted-foreground/40 text-xs leading-relaxed">
                  {t('settings.provider.api_host_drawer_hint')}
                </p>
              )}
            </div>
          )
        })}

        {addableEndpointTypes.length > 0 && (
          <Popover open={addEndpointOpen} onOpenChange={setAddEndpointOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" className={customHeaderDrawerClasses.addRowButton}>
                <Plus className="size-2.5 shrink-0" aria-hidden />
                <span>{t('settings.provider.more_endpoints.add')}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-1.5">
              <MenuList>
                {addableEndpointTypes.map((type) => (
                  <MenuItem
                    key={type}
                    label={t(ENDPOINT_TYPE_LABEL_KEYS[type]!)}
                    onClick={() => handleAddEndpoint(type)}
                  />
                ))}
              </MenuList>
            </PopoverContent>
          </Popover>
        )}

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
