import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { TopView } from '@renderer/components/TopView'
import { useProviders } from '@renderer/hooks/useProviders'
import { getFancyProviderName } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { getProviderHostTopology } from '@renderer/pages/settings/ProviderSettings/utils/providerTopology'
import type { ProviderType } from '@renderer/types'
import { maskApiKey } from '@renderer/utils'
import { Eye, EyeOff } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  displayName: string
}

interface Props extends ShowParams {
  resolve: (result: PopupResult) => void
}

const PopupContainer = ({ id, apiKey: newApiKey, baseUrl, type, name, resolve }: Props) => {
  const { t } = useTranslation()
  const { providers: rawProviders } = useProviders()
  const [open, setOpen] = useState(true)
  const resolvedRef = useRef(false)
  const [showFullKey, setShowFullKey] = useState(false)
  const providers = useMemo(() => (Array.isArray(rawProviders) ? rawProviders : []), [rawProviders])

  const foundProvider = providers.find((p) => p.id === id)
  const existingApiHost = getProviderHostTopology(foundProvider).primaryBaseUrl
  const { data: apiKeysData, isLoading: apiKeysLoading } = useQuery('/providers/:providerId/api-keys', {
    params: { providerId: id },
    enabled: foundProvider !== undefined
  })
  const baseProvider: ImportedProviderData = foundProvider
    ? {
        id: foundProvider.id,
        name: foundProvider.name,
        type: type || 'openai',
        apiKey: '',
        apiHost: existingApiHost
      }
    : {
        id,
        name: name || id,
        type: type || 'openai',
        apiKey: '',
        apiHost: baseUrl || ''
      }

  const displayName = foundProvider ? getFancyProviderName(foundProvider) : baseProvider.name
  const existingKeys = apiKeysData?.keys?.map((k) => k.key.trim()).filter(Boolean) ?? []
  const trimmedNewKey = newApiKey.trim()
  const keyAlreadyExists = existingKeys.includes(trimmedNewKey)
  const baseUrlChanged = Boolean(baseUrl) && baseUrl !== baseProvider.apiHost
  const okDisabled = (foundProvider !== undefined && apiKeysLoading) || (keyAlreadyExists && !baseUrlChanged)

  const confirmMessage = keyAlreadyExists
    ? t('settings.models.provider_key_already_exists', { provider: displayName })
    : t('settings.models.provider_key_add_confirm', { provider: displayName })

  const okText = apiKeysLoading ? t('common.loading') : keyAlreadyExists ? t('common.confirm') : t('common.add')

  const closeWithResult = (result: PopupResult) => {
    if (resolvedRef.current) {
      return
    }
    resolvedRef.current = true
    setOpen(false)
    resolve(result)
  }

  const handleOk = () => {
    const finalApiKey = keyAlreadyExists ? '' : trimmedNewKey
    const finalApiHost = baseUrlChanged ? baseUrl : baseProvider.apiHost

    if (finalApiKey === baseProvider.apiKey && finalApiHost === baseProvider.apiHost) {
      closeWithResult({ updatedProvider: undefined, isNew: !foundProvider, displayName })
      return
    }

    const updatedProvider: ImportedProviderData = {
      ...baseProvider,
      apiKey: finalApiKey,
      apiHost: finalApiHost
    }
    closeWithResult({ updatedProvider, isNew: !foundProvider, displayName })
  }

  const handleCancel = () => {
    closeWithResult({ updatedProvider: undefined, isNew: !foundProvider, displayName })
  }

  const rows = [
    { label: t('settings.models.provider_name'), value: displayName },
    { label: t('settings.models.provider_id'), value: baseProvider.id },
    ...(baseUrl ? [{ label: t('settings.models.base_url'), value: baseUrl }] : [])
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCancel()
        }
      }}>
      <DialogContent className="provider-settings-default-scope gap-5 rounded-2xl border-[color:var(--color-border-fg-muted)] bg-(--color-background) p-5 sm:max-w-md">
        <DialogHeader className="gap-1.5 pr-6">
          <DialogTitle className="text-[length:var(--font-size-body-md)] text-foreground/90 leading-[var(--line-height-body-md)]">
            {t('settings.models.provider_key_confirm_title', { provider: displayName })}
          </DialogTitle>
          <DialogDescription className="text-[length:var(--font-size-body-sm)] text-muted-foreground/80 leading-[var(--line-height-body-sm)]">
            {confirmMessage}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-[color:var(--color-border-fg-muted)] bg-background">
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 border-[color:var(--color-border-fg-hairline)] border-b px-3 py-2.5 last:border-b-0">
                <div className="text-[length:var(--font-size-body-xs)] text-muted-foreground">{row.label}</div>
                <div className="min-w-0 truncate text-[length:var(--font-size-body-sm)] text-foreground/85">
                  {row.value}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-3 py-2.5">
              <div className="text-[length:var(--font-size-body-xs)] text-muted-foreground">
                {t('settings.models.api_key')}
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-[length:var(--font-size-body-sm)] text-foreground/85">
                  {showFullKey ? newApiKey : maskApiKey(newApiKey)}
                </span>
                <Button variant="ghost" size="icon-sm" onClick={() => setShowFullKey((prev) => !prev)}>
                  {showFullKey ? <Eye size={16} /> : <EyeOff size={16} />}
                </Button>
              </div>
            </div>
          </div>
        </div>
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

const TopViewKey = 'UrlSchemaInfoPopup'

export default class UrlSchemaInfoPopup {
  static topviewId = 0
  static hide() {
    TopView.hide(TopViewKey)
  }
  static show(props: ShowParams) {
    return new Promise<PopupResult>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        TopViewKey
      )
    })
  }
}
