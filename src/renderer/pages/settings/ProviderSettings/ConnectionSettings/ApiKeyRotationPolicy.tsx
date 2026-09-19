import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import type { ApiKeyRotationPolicy as RotationPolicy } from '@shared/data/preference/preferenceTypes'

interface Props {
  providerId: string
}

/**
 * How this provider picks among its keys. Only worth showing with more than one — with a single
 * key both policies do the same thing.
 */
export function ApiKeyRotationPolicy({ providerId }: Props) {
  const { t } = useTranslation()
  const [rotation, setRotation] = usePreference('chat.routing.key_rotation')
  const policy = rotation[providerId] ?? 'round-robin'

  const handleChange = useCallback(
    (next: RotationPolicy) => {
      void setRotation({ ...rotation, [providerId]: next })
    },
    [providerId, rotation, setRotation]
  )

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm">{t('settings.provider.api_key.rotation.label')}</div>
        <div className="text-muted-foreground text-xs leading-5">
          {t(`settings.provider.api_key.rotation.${policy}_hint`)}
        </div>
      </div>
      <Selector
        value={policy}
        options={[
          { value: 'round-robin', label: t('settings.provider.api_key.rotation.round-robin') },
          { value: 'sequential', label: t('settings.provider.api_key.rotation.sequential') }
        ]}
        onChange={handleChange}
      />
    </div>
  )
}
