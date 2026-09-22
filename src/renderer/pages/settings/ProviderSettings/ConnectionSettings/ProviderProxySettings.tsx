import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Label, RadioGroup, RadioGroupItem, TextField } from '@cherrystudio/ui'
import { useProvider, useProviderMutations } from '@renderer/hooks/useProvider'
import type { ProviderProxyConfig } from '@shared/data/types/provider'

interface ProviderProxySettingsProps {
  providerId: string
}

export default function ProviderProxySettings({ providerId }: ProviderProxySettingsProps) {
  const { t } = useTranslation()
  const { provider } = useProvider(providerId)
  const { updateProvider } = useProviderMutations(providerId)
  const [isCommitting, setIsCommitting] = useState(false)

  const currentProxy = provider?.settings?.proxy

  const handleProxyModeChange = useCallback(
    async (mode: string) => {
      setIsCommitting(true)
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

        await updateProvider({
          settings: {
            ...provider?.settings,
            proxy: newProxy
          }
        })
      } finally {
        setIsCommitting(false)
      }
    },
    [provider, updateProvider, currentProxy]
  )

  const handleCustomUrlChange = useCallback(
    async (url: string) => {
      if (!url.trim()) return
      setIsCommitting(true)
      try {
        await updateProvider({
          settings: {
            ...provider?.settings,
            proxy: {
              mode: 'custom',
              url
            }
          }
        })
      } finally {
        setIsCommitting(false)
      }
    },
    [provider, updateProvider]
  )

  if (!provider) return null

  const proxyMode = currentProxy?.mode ?? 'system'
  const proxyUrl = currentProxy?.mode === 'custom' ? currentProxy.url : ''

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-2 block text-sm font-medium">{t('settings.provider.proxy_mode')}</Label>
        <RadioGroup value={proxyMode} onValueChange={handleProxyModeChange} disabled={isCommitting}>
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
          <TextField
            label={t('settings.provider.proxy_url')}
            value={proxyUrl}
            onChange={(e) => {
              const newUrl = e.currentTarget.value
              if (newUrl === proxyUrl) return
              void handleCustomUrlChange(newUrl)
            }}
            placeholder={t('settings.provider.proxy_url_placeholder')}
            disabled={isCommitting}
          />
        </div>
      )}
    </div>
  )
}
