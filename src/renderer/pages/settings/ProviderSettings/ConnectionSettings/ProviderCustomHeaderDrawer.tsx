import { isEmpty, trim } from 'es-toolkit/compat'
import { Braces, List, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'

import {
  Badge,
  Button,
  InputGroup,
  InputGroupInput,
  Label,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { validateApiHost } from '@renderer/utils/api'
import { cn } from '@renderer/utils/style'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { EndpointConfig } from '@shared/data/types/provider'
import { getProviderHostTopology } from '@shared/utils/providerTopology'

import { ProviderImageEndpointFields } from '../components/ProviderImageEndpointFields'
import { useProviderModelSync } from '../hooks/useProviderModelSync'
import ProviderActions from '../primitives/ProviderActions'
import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'
import { customHeaderDrawerClasses, drawerClasses, fieldClasses } from '../primitives/ProviderSettingsPrimitives'
import {
  findInvalidProviderImageEndpointDraft,
  mergeProviderImageEndpointDraft,
  type ProviderImageEndpointDraft,
  type ProviderImageEndpointDraftField,
  readProviderImageEndpointDraft
} from '../utils/providerImageEndpoints'

const logger = loggerService.withContext('ProviderCustomHeaderDrawer')

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

const IMAGE_ENDPOINT_TYPES = new Set<EndpointType>([
  ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
  ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
])

const DEFAULT_CHAT_ENDPOINT_TYPES = new Set<EndpointType>([
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OLLAMA_CHAT,
  ENDPOINT_TYPE.OLLAMA_GENERATE,
  ENDPOINT_TYPE.OPENAI_TEXT_COMPLETIONS
])

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

/**
 * Build an `extraHeaders` merge patch that fully replaces the stored headers.
 *
 * PATCH /providers/:providerId applies `providerSettings` with JSON Merge Patch
 * semantics: keys absent from the patch are kept, so deletions must be expressed
 * as explicit `null` values (see ProviderService.applyJsonMergePatch).
 */
function buildExtraHeadersReplacementPatch(
  previous: Record<string, string>,
  next: Record<string, string>
): Record<string, string | null> {
  const removed = Object.keys(previous).filter((key) => !Object.hasOwn(next, key))
  return { ...next, ...Object.fromEntries(removed.map((key) => [key, null])) }
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
export function resolveEndpointTypes(
  provider: { endpointConfigs?: Partial<Record<EndpointType, EndpointConfig>> } | null | undefined,
  primary: EndpointType
): EndpointType[] {
  const configured = Object.keys(provider?.endpointConfigs ?? {}) as EndpointType[]
  const others = configured.filter((type) => type !== primary && !IMAGE_ENDPOINT_TYPES.has(type)).sort()
  return IMAGE_ENDPOINT_TYPES.has(primary) ? others : [primary, ...others]
}

export interface EndpointDraft {
  baseUrl: string
}

/**
 * Merge per-endpoint drafts back into a full endpointConfigs object.
 *
 * Each drafted endpoint's `baseUrl` is written or stripped from the draft;
 * other configured fields on the entry are kept. An empty entry is dropped.
 */
export function mergeEndpointConfigs(
  existing: Partial<Record<EndpointType, EndpointConfig>> | undefined,
  drafts: Record<string, EndpointDraft>
): Partial<Record<EndpointType, EndpointConfig>> {
  const out: Partial<Record<EndpointType, EndpointConfig>> = { ...existing }
  for (const [type, draft] of Object.entries(drafts) as [EndpointType, EndpointDraft][]) {
    const next: EndpointConfig = { ...out[type] }
    const value = trim(draft.baseUrl)
    if (value) {
      next.baseUrl = value
    } else {
      delete next.baseUrl
    }
    if (!isEmpty(next)) {
      out[type] = next
    } else {
      delete out[type]
    }
  }
  return out
}

/**
 * First non-empty secondary-endpoint draft that fails URL validation, or
 * `null` if all secondaries are empty or valid. The primary slot is
 * validated separately (it has its own required-ness rules).
 */
export function findInvalidSecondaryEndpointUrl(
  drafts: Record<string, EndpointDraft>,
  primary: EndpointType
): EndpointType | null {
  for (const [type, draft] of Object.entries(drafts) as [EndpointType, EndpointDraft][]) {
    if (type === primary) continue
    const value = trim(draft.baseUrl)
    if (value && !validateApiHost(value)) {
      return type
    }
  }
  return null
}

export default function ProviderCustomHeaderDrawer({ providerId, open, onClose }: ProviderCustomHeaderDrawerProps) {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const { syncProviderModels } = useProviderModelSync(providerId)

  const topology = getProviderHostTopology(provider)
  const primaryEndpoint = topology.primaryEndpoint
  const endpointTypes = useMemo(() => resolveEndpointTypes(provider, primaryEndpoint), [provider, primaryEndpoint])

  const sourceHeaders = useMemo<Record<string, string>>(
    () => ({ ...provider?.settings?.extraHeaders }),
    [provider?.settings?.extraHeaders]
  )

  const [rows, setRows] = useState<HeaderRow[]>([])
  const [endpointDrafts, setEndpointDrafts] = useState<Record<string, EndpointDraft>>({})
  const [defaultChatEndpoint, setDefaultChatEndpoint] = useState<EndpointType>(primaryEndpoint)
  const [imageEndpointDraft, setImageEndpointDraft] = useState<ProviderImageEndpointDraft>(() =>
    readProviderImageEndpointDraft(undefined)
  )
  const [invalidImageEndpointField, setInvalidImageEndpointField] = useState<ProviderImageEndpointDraftField | null>(
    null
  )
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

    const drafts: Record<string, EndpointDraft> = {}
    for (const type of endpointTypes) {
      drafts[type] = {
        baseUrl: trim(provider?.endpointConfigs?.[type]?.baseUrl ?? '')
      }
    }
    setEndpointDrafts(drafts)
    setDefaultChatEndpoint(primaryEndpoint)
    setImageEndpointDraft(readProviderImageEndpointDraft(provider?.endpointConfigs))
    setInvalidImageEndpointField(null)
    setVisibleEndpointTypes(endpointTypes)
    setAddEndpointOpen(false)
    setRows(headersObjectToRows(sourceHeaders))
    setJsonDraft(JSON.stringify(sourceHeaders, null, 2))
    setHeadersUiMode('list')
  }, [open, sourceHeaders, endpointTypes, primaryEndpoint, provider?.endpointConfigs])

  const syncListToJson = useCallback(() => {
    setJsonDraft(JSON.stringify(rowsToHeadersObject(rows), null, 2))
  }, [rows])

  const applyJsonToRowsOrToast = useCallback((): boolean => {
    const parsed = parseHeadersJsonDraft(jsonDraft)
    if (!parsed.ok) {
      toast.error(t('settings.provider.copilot.invalid_json'))
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

    // Validate the selected default baseUrl — non-empty + URL-shape, unless
    // this is Vertex (whose text endpoints are account-managed).
    const defaultEndpointDraft = trim(endpointDrafts[defaultChatEndpoint]?.baseUrl ?? '')
    const isAccountManagedProvider = provider.authType === 'iam-gcp'
    if (!isAccountManagedProvider && (!defaultEndpointDraft || !validateApiHost(defaultEndpointDraft))) {
      toast.error(t('settings.provider.api_host_no_valid'))
      return
    }

    // Secondary endpoints are optional, but a non-empty one must still be a
    // valid URL — otherwise it surfaces as an opaque chat-traffic failure later.
    if (findInvalidSecondaryEndpointUrl(endpointDrafts, defaultChatEndpoint)) {
      toast.error(t('settings.provider.api_host_no_valid'))
      return
    }

    const invalidImageEndpoint = findInvalidProviderImageEndpointDraft(imageEndpointDraft)
    if (invalidImageEndpoint) {
      setInvalidImageEndpointField(invalidImageEndpoint)
      toast.error(t('settings.provider.api_host_no_valid'))
      return
    }

    const textEndpointConfigs = mergeEndpointConfigs(provider.endpointConfigs, endpointDrafts)
    const nextEndpointConfigs = mergeProviderImageEndpointDraft(textEndpointConfigs, imageEndpointDraft)
    const previousDefaultBaseUrl = trim(provider.endpointConfigs?.[primaryEndpoint]?.baseUrl ?? '')
    const defaultEndpointChanged = defaultChatEndpoint !== primaryEndpoint

    let parsedHeaders: Record<string, string>
    if (headersUiMode === 'json') {
      const parsed = parseHeadersJsonDraft(jsonDraft)
      if (!parsed.ok) {
        toast.error(t('settings.provider.copilot.invalid_json'))
        return
      }
      parsedHeaders = parsed.headers
    } else {
      parsedHeaders = rowsToHeadersObject(rows)
    }

    try {
      await updateProvider({
        endpointConfigs: nextEndpointConfigs,
        defaultChatEndpoint,
        providerSettings: {
          ...provider.settings,
          extraHeaders: buildExtraHeadersReplacementPatch(sourceHeaders, parsedHeaders)
        }
      })
    } catch (error) {
      // Surface the failure and keep the drawer open so the user can retry
      // instead of silently losing their edits.
      logger.error('Failed to save provider request config', error as Error, { providerId })
      toast.error(t('settings.provider.save_failed'))
      return
    }

    if (defaultEndpointChanged || defaultEndpointDraft !== previousDefaultBaseUrl) {
      syncProviderModels({
        ...provider,
        endpointConfigs: nextEndpointConfigs,
        defaultChatEndpoint
      }).catch((error) => {
        logger.error('Background model sync after endpoint change failed', error as Error, { providerId })
      })
    }

    toast.success(t('message.save.success.title'))
    onClose()
  }, [
    defaultChatEndpoint,
    endpointDrafts,
    headersUiMode,
    imageEndpointDraft,
    jsonDraft,
    onClose,
    primaryEndpoint,
    provider,
    providerId,
    rows,
    sourceHeaders,
    syncProviderModels,
    t,
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

  /** Endpoint types not yet shown that the user can still add. */
  const addableEndpointTypes = (Object.keys(ENDPOINT_TYPE_LABEL_KEYS) as EndpointType[]).filter(
    (type) => !visibleEndpointTypes.includes(type)
  )

  const handleAddEndpoint = (type: EndpointType) => {
    setVisibleEndpointTypes((prev) => (prev.includes(type) ? prev : [...prev, type]))
    setEndpointDrafts((prev) => ({ ...prev, [type]: prev[type] ?? { baseUrl: '' } }))
    setAddEndpointOpen(false)
  }

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t('settings.provider.request_configuration')}
      footer={footer}>
      <div className={customHeaderDrawerClasses.bodyScroll}>
        {visibleEndpointTypes.map((type, index) => {
          const isInitialPrimary = index === 0
          const isDefault = type === defaultChatEndpoint
          const labelKey = ENDPOINT_TYPE_LABEL_KEYS[type]
          const label = labelKey ? t(labelKey) : isInitialPrimary ? t('settings.provider.api_host') : type
          const inputId = `provider-request-config-endpoint-${type}`
          const isConfiguredDefaultCandidate =
            type === primaryEndpoint ||
            Object.prototype.hasOwnProperty.call(provider?.endpointConfigs ?? {}, type) ||
            Boolean(trim(endpointDrafts[type]?.baseUrl ?? ''))
          return (
            <div key={type} className="space-y-1.5">
              <div className="flex min-h-5 items-center gap-2">
                <Label className="text-[13px] text-foreground" htmlFor={inputId}>
                  {label}
                </Label>
                {isDefault ? (
                  <Badge
                    variant="secondary"
                    className="h-5 border-0 px-1.5 py-0 text-xs font-normal text-foreground-tertiary">
                    {t('settings.provider.create_custom.endpoint_fields.default_chat')}
                  </Badge>
                ) : DEFAULT_CHAT_ENDPOINT_TYPES.has(type) && isConfiguredDefaultCandidate ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="relative h-5 min-h-0 rounded-full px-2 text-xs transition-transform before:absolute before:inset-x-0 before:-top-5 before:bottom-0 before:content-[''] active:scale-[0.96]"
                    onClick={() => setDefaultChatEndpoint(type)}>
                    {t('settings.provider.create_custom.endpoint_fields.set_default_chat')}
                  </Button>
                ) : null}
              </div>
              <InputGroup className={fieldClasses.inputGroup}>
                <InputGroupInput
                  id={inputId}
                  className={fieldClasses.input}
                  value={endpointDrafts[type]?.baseUrl ?? ''}
                  placeholder={t('settings.provider.api_host')}
                  onChange={(e) =>
                    setEndpointDrafts((prev) => ({
                      ...prev,
                      [type]: { ...(prev[type] ?? { baseUrl: '' }), baseUrl: e.target.value }
                    }))
                  }
                  autoComplete="off"
                />
              </InputGroup>
              {isDefault && (
                <p className="text-xs leading-relaxed wrap-break-word text-muted-foreground">
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

        <ProviderImageEndpointFields
          value={imageEndpointDraft}
          invalidField={invalidImageEndpointField}
          onChange={(value) => {
            setImageEndpointDraft(value)
            setInvalidImageEndpointField(null)
          }}
        />

        <div className="space-y-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs text-muted-foreground">{t('settings.provider.copilot.custom_headers')}</span>
            <Tooltip content={toggleLabel}>
              <button
                type="button"
                aria-label={toggleLabel}
                className={cn(fieldClasses.iconButton, 'shrink-0')}
                onClick={toggleHeadersUiMode}>
                {headersUiMode === 'list' ? (
                  <Braces className="size-3" aria-hidden />
                ) : (
                  <List className="size-3" aria-hidden />
                )}
              </button>
            </Tooltip>
          </div>

          {headersUiMode === 'list' ? (
            <>
              {rows.length > 0 ? (
                <div className={customHeaderDrawerClasses.headerList}>
                  {rows.map((row) => (
                    <div key={row.id} className={customHeaderDrawerClasses.headerRow}>
                      <InputGroup className={fieldClasses.inputGroup}>
                        <InputGroupInput
                          id={`provider-hdr-key-${row.id}`}
                          className={fieldClasses.input}
                          value={row.key}
                          onChange={(e) => {
                            const v = e.target.value
                            setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, key: v } : r)))
                          }}
                          placeholder={t('settings.provider.copilot.header_name_placeholder')}
                          aria-label={t('settings.provider.copilot.header_field_name')}
                          autoComplete="off"
                        />
                      </InputGroup>
                      <InputGroup className={fieldClasses.inputGroup}>
                        <InputGroupInput
                          id={`provider-hdr-val-${row.id}`}
                          className={fieldClasses.input}
                          value={row.value}
                          onChange={(e) => {
                            const v = e.target.value
                            setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, value: v } : r)))
                          }}
                          placeholder={t('settings.provider.copilot.header_value_placeholder')}
                          aria-label={t('settings.provider.copilot.header_field_value')}
                          autoComplete="off"
                        />
                      </InputGroup>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={customHeaderDrawerClasses.removeIconButton}
                        onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                        aria-label={
                          row.key.trim()
                            ? t('settings.provider.delete.header', { key: row.key.trim() })
                            : t('common.delete')
                        }>
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
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
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('settings.provider.copilot.headers_description')}
              </p>
            </div>
          )}
        </div>
      </div>
    </ProviderSettingsDrawer>
  )
}
