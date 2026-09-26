// Where a key came from and a one-click way back to the provider's key page — so a
// quota-exhausted key doesn't leave the user asking "where did I even get this one".

import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input, Tooltip } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'

import { apiKeyListClasses } from '../primitives/ProviderSettingsPrimitives'

interface Props {
  providerId: string
  keyId: string
  note?: string
}

export const ApiKeyNote = ({ providerId, keyId, note }: Props) => {
  const { t } = useTranslation()
  const { provider, updateApiKey } = useProvider(providerId)
  // Derived from the provider preset (metadata.website.apiKey) — the same console page
  // renews any key on this provider, so there is nothing per-key for the user to type.
  const apiKeyWebsite = provider?.websites?.apiKey

  const [value, setValue] = useState(note ?? '')
  useEffect(() => setValue(note ?? ''), [note])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed === (note ?? '')) return
    void updateApiKey(keyId, { note: trimmed })
  }

  return (
    <div className="flex items-center gap-1.5 px-4 pb-2">
      <Input
        value={value}
        placeholder={t('settings.provider.api_key.note_placeholder')}
        className="h-7 rounded-lg px-2 text-xs"
        aria-label={t('settings.provider.api_key.note_placeholder')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />
      {apiKeyWebsite ? (
        <Tooltip content={t('settings.provider.api_key.open_key_page')}>
          <a
            href={apiKeyWebsite}
            target="_blank"
            rel="noreferrer"
            className={apiKeyListClasses.keyIconButton}
            aria-label={t('settings.provider.api_key.open_key_page')}>
            <ExternalLink />
          </a>
        </Tooltip>
      ) : null}
    </div>
  )
}
