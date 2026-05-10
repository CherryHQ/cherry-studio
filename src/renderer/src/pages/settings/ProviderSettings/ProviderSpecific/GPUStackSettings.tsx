import { EditableNumber } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProviders'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ProviderHelpText,
  ProviderHelpTextRow,
  ProviderSettingsSubtitle
} from '../shared/primitives/ProviderSettingsPrimitives'

interface Props {
  providerId: string
}

const GPUStackSettings: FC<Props> = ({ providerId }) => {
  const { provider, updateProvider } = useProvider(providerId)
  const { t } = useTranslation()

  const keepAliveTime = provider?.settings?.keepAliveTime ?? 0
  const [keepAliveMinutes, setKeepAliveMinutes] = useState(keepAliveTime)

  useEffect(() => {
    setKeepAliveMinutes(provider?.settings?.keepAliveTime ?? 0)
  }, [provider?.settings?.keepAliveTime])

  const handleBlur = async () => {
    if (keepAliveMinutes === keepAliveTime) return
    await updateProvider({ providerSettings: { ...provider?.settings, keepAliveTime: keepAliveMinutes } })
  }

  return (
    <div>
      <ProviderSettingsSubtitle className="mb-1">{t('gpustack.keep_alive_time.title')}</ProviderSettingsSubtitle>
      <div className="w-full [&>div]:block [&>div]:w-full">
        <EditableNumber
          value={keepAliveMinutes}
          min={0}
          step={5}
          suffix={t('gpustack.keep_alive_time.placeholder')}
          align="start"
          changeOnBlur={false}
          onChange={(v) => setKeepAliveMinutes(Number(v ?? 0))}
          onBlur={() => {
            void handleBlur()
          }}
        />
      </div>
      <ProviderHelpTextRow>
        <ProviderHelpText>{t('gpustack.keep_alive_time.description')}</ProviderHelpText>
      </ProviderHelpTextRow>
    </div>
  )
}

export default GPUStackSettings
