import { Eye, EyeOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input
} from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { useProviders } from '@renderer/hooks/useProvider'
import {
  getFancyProviderName,
  isCanonicalPresetProvider
} from '@renderer/pages/settings/ProviderSettings/utils/providerDisplay'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import type { ProviderType } from '@renderer/types/provider'
import { maskApiKey } from '@renderer/utils/api'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { formatApiHost, formatOllamaApiHost } from '@shared/utils/api'
import { getProviderHostTopology } from '@shared/utils/providerTopology'

interface ShowParams {
  id: string
  apiKey: string
  baseUrl: string
  type?: ProviderType
  name?: string
}

interface ImportedProviderData {
  id: string
  name: string
  type: ProviderType
  apiKey: string
  apiHost: string
}

interface PopupResult {
  updatedProvider?: ImportedProviderData
  isNew: boolean
  nameOnly: boolean
  displayName: string
}

type Props = ShowParams & PopupInjectedProps<PopupResult>

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

type Resolution = 'merge' | 'replace'

function getHost(url: string) {
  try {
    // `.host` excludes userinfo, so a parseable URL never leaks credentials.
    return new URL(url).host
  } catch {
    // Never echo an unparseable value into the notice: it could carry userinfo
    // or embedded secrets.
    return ''
  }
}

/**
 * Host the transport layer would actually dispatch to. Stored base URLs pass through
 * the app's own formatting before any request (formatApiHost version suffixes, Ollama
 * /v1-/api-/chat stripping), which can turn a bare scheme into a host ('http://' ->
 * 'http:/v1' -> host 'v1') or eat a host entirely ('http://v1' on Ollama -> 'api').
 * Values still unparseable after formatting cannot be constructed as request URLs
 * (Electron net.fetch rejects them with the same WHATWG parser before any network
 * I/O), so they are counted, never echoed. The disclosed hosts mirror the chat
 * transport: model listing and sibling paths normalize differently, so the notice
 * copy deliberately avoids claiming exclusivity.
 */
function resolveTransportHost(baseUrl: string, endpointType: EndpointType): string {
  const formatted =
    endpointType === ENDPOINT_TYPE.OLLAMA_CHAT || endpointType === ENDPOINT_TYPE.OLLAMA_GENERATE
      ? formatOllamaApiHost(baseUrl)
      : endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
        ? formatApiHost(baseUrl, true, 'v1beta')
        : formatApiHost(baseUrl)
  return getHost(formatted)
}

/** Endpoint the deep-link import hook writes the imported base URL to for this type. */
function importEndpointType(type?: ProviderType): EndpointType {
  switch (type) {
    case 'anthropic':
    case 'vertex-anthropic':
      return ENDPOINT_TYPE.ANTHROPIC_MESSAGES
    case 'openai-response':
      return ENDPOINT_TYPE.OPENAI_RESPONSES
    case 'gemini':
    case 'vertexai':
      return ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    case 'ollama':
      return ENDPOINT_TYPE.OLLAMA_CHAT
    default:
      return ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  }
}

const PopupContainer = ({ id, apiKey: newApiKey, baseUrl, type, name, open, resolve }: Props) => {
  const { t } = useTranslation()
  const { providers: rawProviders } = useProviders()
  const [showFullKey, setShowFullKey] = useState(false)
  const [editedName, setEditedName] = useState<string>()
  const [editedId, setEditedId] = useState<string>()
  const [resolution, setResolution] = useState<Resolution>('merge')
  const providers = useMemo(() => (Array.isArray(rawProviders) ? rawProviders : []), [rawProviders])

  // An untouched link ID stays exactly as delivered, whitespace included; only user-edited
  // input is normalized (and pattern-validated below).
  const finalId = editedId === undefined ? id : editedId.trim()
  const idInvalid = !finalId || (finalId !== id && !PROVIDER_ID_PATTERN.test(finalId))
  const foundProvider = providers.find((p) => p.id === finalId)
  const replace = foundProvider !== undefined && resolution === 'replace'
  const existingApiHost = getProviderHostTopology(foundProvider).primaryBaseUrl
  const { data: apiKeysData, isLoading: apiKeysLoading } = useQuery('/providers/:providerId/api-keys', {
    params: { providerId: finalId },
    enabled: foundProvider !== undefined,
    // Editing the ID swaps or disables this query's key. Retaining the previous provider's
    // keys here (the useQuery default) would mark the imported key as a duplicate of a
    // provider it was never checked against, stripping the credential from a
    // separate-provider import while still reporting success.
    swrOptions: { keepPreviousData: false }
  })
  const baseProvider: ImportedProviderData =
    foundProvider && !replace
      ? {
          id: foundProvider.id,
          name: foundProvider.name,
          type: type || 'openai',
          apiKey: '',
          apiHost: existingApiHost
        }
      : {
          id: finalId,
          name: name || id,
          type: type || 'openai',
          apiKey: '',
          apiHost: foundProvider ? existingApiHost : baseUrl || ''
        }

  const canEditName = !foundProvider || !isCanonicalPresetProvider(foundProvider)
  const finalName = (editedName ?? baseProvider.name).trim()
  const nameChanged = canEditName && finalName !== (foundProvider?.name ?? baseProvider.name)
  const displayName = nameChanged ? finalName : foundProvider ? getFancyProviderName(foundProvider) : baseProvider.name
  const existingKeys = apiKeysData?.keys?.map((k) => k.key.trim()).filter(Boolean) ?? []
  const trimmedNewKey = newApiKey.trim()
  const keyAlreadyExists = existingKeys.includes(trimmedNewKey)
  const baseUrlChanged = replace && Boolean(baseUrl) && baseUrl !== existingApiHost
  const finalApiHost = baseUrlChanged ? baseUrl : baseProvider.apiHost
  const { destinationHosts, hiddenDestinationCount } = useMemo(() => {
    const hosts = new Set<string>()
    let hidden = 0
    // A merged key joins the provider's shared credential pool, whose requests can target
    // every configured endpoint host — disclose each of them, not just the primary one.
    if (foundProvider && !replace) {
      for (const [endpointType, config] of Object.entries(foundProvider.endpointConfigs ?? {})) {
        if (!config?.baseUrl) {
          continue
        }
        const host = resolveTransportHost(config.baseUrl, endpointType as EndpointType)
        if (host) {
          hosts.add(host)
        } else {
          hidden += 1
        }
      }
    }
    if (!foundProvider || replace) {
      // New or replaced provider: the imported base URL becomes the endpoint.
      const effectiveHost = resolveTransportHost(finalApiHost || baseUrl, importEndpointType(type))
      if (effectiveHost) {
        hosts.add(effectiveHost)
      } else if (finalApiHost || baseUrl) {
        hidden += 1
      }
    }
    return { destinationHosts: [...hosts], hiddenDestinationCount: hidden }
  }, [foundProvider, replace, finalApiHost, baseUrl, type])
  const okDisabled =
    idInvalid ||
    !finalName ||
    (foundProvider !== undefined && apiKeysLoading) ||
    (keyAlreadyExists && !baseUrlChanged && !nameChanged)

  const confirmMessage = keyAlreadyExists
    ? t('settings.models.provider_key_already_exists', { provider: displayName })
    : t('settings.models.provider_key_add_confirm', { provider: displayName })

  const okText = apiKeysLoading ? t('common.loading') : keyAlreadyExists ? t('common.confirm') : t('common.add')

  const handleOk = () => {
    const finalApiKey = keyAlreadyExists ? '' : trimmedNewKey

    if (!nameChanged && finalApiKey === baseProvider.apiKey && finalApiHost === baseProvider.apiHost) {
      resolve({ updatedProvider: undefined, isNew: !foundProvider, nameOnly: false, displayName })
      return
    }

    const updatedProvider: ImportedProviderData = {
      ...baseProvider,
      name: canEditName ? finalName : (foundProvider?.name ?? baseProvider.name),
      apiKey: finalApiKey,
      apiHost: finalApiHost
    }
    resolve({
      updatedProvider,
      isNew: !foundProvider,
      nameOnly: Boolean(foundProvider) && !replace,
      displayName
    })
  }

  const handleCancel = () => {
    resolve({ updatedProvider: undefined, isNew: !foundProvider, nameOnly: false, displayName })
  }

  const rows = [...(baseUrl ? [{ label: t('settings.models.base_url'), value: baseUrl }] : [])]

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCancel()
        }
      }}>
      <DialogContent className="gap-5 rounded-2xl border-border-subtle bg-popover p-5 sm:max-w-md">
        <DialogHeader className="gap-1.5 pr-6">
          <DialogTitle className="text-sm leading-5 text-foreground">
            {t('settings.models.provider_key_confirm_title', { provider: displayName })}
          </DialogTitle>
          <DialogDescription className="text-sm leading-5 text-muted-foreground">{confirmMessage}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-transparent">
            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 border-b border-border-subtle px-3 py-2.5">
              <label htmlFor="provider-import-name" className="text-xs text-muted-foreground">
                {t('settings.models.provider_name')}
              </label>
              <Input
                id="provider-import-name"
                value={canEditName ? (editedName ?? baseProvider.name) : displayName}
                onChange={(event) => setEditedName(event.target.value)}
                readOnly={!canEditName}
              />
            </div>
            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 border-b border-border-subtle px-3 py-2.5">
              <label htmlFor="provider-import-id" className="text-xs text-muted-foreground">
                {t('settings.models.provider_id')}
              </label>
              <Input
                id="provider-import-id"
                value={editedId ?? id}
                onChange={(event) => setEditedId(event.target.value)}
                aria-invalid={idInvalid}
              />
            </div>
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 border-b border-border-subtle px-3 py-2.5 last:border-b-0">
                <div className="text-xs text-muted-foreground">{row.label}</div>
                <div className="min-w-0 truncate text-sm text-foreground">{row.value}</div>
              </div>
            ))}
            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-3 py-2.5">
              <div className="text-xs text-muted-foreground">{t('settings.models.api_key')}</div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-sm text-foreground">
                  {showFullKey ? newApiKey : maskApiKey(newApiKey)}
                </span>
                <Button variant="ghost" size="icon-sm" onClick={() => setShowFullKey((prev) => !prev)}>
                  {showFullKey ? <Eye size={16} /> : <EyeOff size={16} />}
                </Button>
              </div>
            </div>
          </div>
        </div>
        {idInvalid && <p className="text-xs text-destructive">{t('settings.models.provider_import_id_invalid')}</p>}
        {foundProvider && !idInvalid && (
          <fieldset className="space-y-1.5 text-xs text-foreground">
            <legend className="mb-1.5 text-muted-foreground">{t('settings.models.provider_import_id_exists')}</legend>
            {(['merge', 'replace'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="provider-import-resolution"
                  checked={resolution === value}
                  onChange={() => setResolution(value)}
                />
                {t(`settings.models.provider_import_resolution_${value}`)}
              </label>
            ))}
          </fieldset>
        )}
        {destinationHosts.length > 0 && hiddenDestinationCount === 0 && (
          <p className="text-xs text-muted-foreground">
            {destinationHosts.length > 1
              ? t('settings.models.provider_import_key_destination_multi', { hosts: destinationHosts.join(', ') })
              : t('settings.models.provider_import_key_destination', { host: destinationHosts[0] })}
          </p>
        )}
        {hiddenDestinationCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {destinationHosts.length > 0
              ? t('settings.models.provider_import_key_destination_unknown_hosts', {
                  hosts: destinationHosts.join(', '),
                  num: hiddenDestinationCount
                })
              : t('settings.models.provider_import_key_destination_unknown_only', { num: hiddenDestinationCount })}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={okDisabled} onClick={handleOk}>
            {okText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const UrlSchemaInfoPopup = createPopup<ShowParams, PopupResult>(PopupContainer, {
  dismissResult: { updatedProvider: undefined, isNew: false, nameOnly: false, displayName: '' }
})

export default UrlSchemaInfoPopup
