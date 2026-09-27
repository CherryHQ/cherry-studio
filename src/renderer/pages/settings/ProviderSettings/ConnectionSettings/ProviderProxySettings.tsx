import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input, Label, RadioGroup, RadioGroupItem } from '@cherrystudio/ui'
import { useProvider, useProviderMutations } from '@renderer/hooks/useProvider'
import type { ProviderProxyConfig } from '@shared/data/types/provider'

interface ProviderProxySettingsProps {
  providerId: string
}

export default function ProviderProxySettings({ providerId }: ProviderProxySettingsProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { updateProvider } = useProviderMutations(providerId)
  const [isCommittingMode, setIsCommittingMode] = useState(false)

  const currentProxy = provider?.settings?.proxy
  const proxyMode = currentProxy?.mode ?? 'system'
  const savedUrl = currentProxy?.mode === 'custom' ? currentProxy.url : ''

  // A local draft, not a mutation fired on every keystroke: committing per keystroke disabled the
  // field mid-round-trip (below) and could resolve out of order, so a saved value could overwrite
  // characters typed after it. Committed once, on blur, instead.
  const [draftUrl, setDraftUrl] = useState(savedUrl)
  useEffect(() => {
    setDraftUrl(savedUrl)
  }, [savedUrl])

  const handleProxyModeChange = useCallback(
    async (mode: string) => {
      setIsCommittingMode(true)
      try {
        let newProxy: ProviderProxyConfig
        if (mode === 'system') {
          newProxy = { mode: 'system' }
        } else if (mode === 'direct') {
          newProxy = { mode: 'direct' }
        } else {
          // custom mode, keep existing URL or empty
          newProxy = {
            mode: 'custom',
            url: currentProxy?.mode === 'custom' ? currentProxy.url : ''
          }
        }

        // providerSettings is an RFC 7396 merge patch — send only the changed key.
        await updateProvider({
          providerSettings: {
            proxy: newProxy
          }
        })
      } finally {
        setIsCommittingMode(false)
      }
    },
    [updateProvider, currentProxy]
  )

  const commitUrl = useCallback(
    async (url: string) => {
      if (url === savedUrl) return
      await updateProvider({
        providerSettings: {
          proxy: { mode: 'custom', url }
        }
      })
    },
    [updateProvider, savedUrl]
  )

  if (!provider) return null

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-2 block text-sm font-medium">{t('settings.provider.proxy_mode')}</Label>
        <RadioGroup value={proxyMode} onValueChange={handleProxyModeChange} disabled={isCommittingMode}>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="system" id="proxy-system" />
            <Label htmlFor="proxy-system" className="font-normal cursor-pointer">
              {t('settings.provider.proxy_mode_system')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="direct" id="proxy-direct" />
            <Label htmlFor="proxy-direct" className="font-normal cursor-pointer">
              {t('settings.provider.proxy_mode_direct')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="custom" id="proxy-custom" />
            <Label htmlFor="proxy-custom" className="font-normal cursor-pointer">
              {t('settings.provider.proxy_mode_custom')}
            </Label>
          </div>
        </RadioGroup>
      </div>

      {proxyMode === 'custom' && (
        <div>
          <Label className="mb-2 block text-sm font-medium">{t('settings.provider.proxy_url')}</Label>
          <Input
            type="url"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.currentTarget.value)}
            onBlur={() => void commitUrl(draftUrl)}
            placeholder={t('settings.provider.proxy_url_placeholder')}
          />
        </div>
      )}
    </div>
  )
}
