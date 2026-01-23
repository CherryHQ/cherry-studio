import { Field, FieldContent, FieldGroup, FieldLabel, Input } from '@cherrystudio/ui'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchProviderOverride } from '@shared/data/presets/web-search-providers'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  provider: WebSearchProvider
  updateProvider: (updates: WebSearchProviderOverride) => void
}

const McpProviderSettings: FC<Props> = ({ provider, updateProvider }) => {
  const { t } = useTranslation()
  const [apiHost, setApiHost] = useState('')

  useEffect(() => {
    setApiHost(provider.apiHost ?? '')
  }, [provider.apiHost])

  const handleBlur = useCallback(() => {
    const value = apiHost.trim().replace(/\/$/, '')
    if (value !== (provider.apiHost || '')) {
      updateProvider({ apiHost: value })
    }
  }, [apiHost, provider.apiHost, updateProvider])

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>{t('settings.provider.api_host')}</FieldLabel>
        <FieldContent>
          <Input
            className="rounded-2xs"
            value={apiHost}
            placeholder={t('settings.provider.api_host')}
            onChange={(e) => setApiHost(e.target.value)}
            onBlur={handleBlur}
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  )
}

export default McpProviderSettings
