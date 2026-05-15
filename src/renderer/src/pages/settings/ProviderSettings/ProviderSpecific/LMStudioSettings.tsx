import { EditableNumber } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProviders'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ProviderHelpText,
  ProviderHelpTextRow,
  ProviderSettingsSubtitle
} from '../primitives/ProviderSettingsPrimitives'

const logger = loggerService.withContext('LMStudioSettings')

interface Props {
  providerId: string
}

const LMStudioSettings: FC<Props> = ({ providerId }) => {
  const { provider, updateProvider } = useProvider(providerId)
  const { t } = useTranslation()

  const keepAliveTime = provider?.settings?.keepAliveTime ?? 0
  const [keepAliveMinutes, setKeepAliveMinutes] = useState(keepAliveTime)

  useEffect(() => {
    setKeepAliveMinutes(provider?.settings?.keepAliveTime ?? 0)
  }, [provider?.settings?.keepAliveTime])

  const handleBlur = async () => {
    if (keepAliveMinutes === keepAliveTime) return
    try {
      await updateProvider({ providerSettings: { ...provider?.settings, keepAliveTime: keepAliveMinutes } })
    } catch (error) {
      logger.error('Failed to save LM Studio keep alive time', { providerId, error })
      window.toast.error(t('settings.provider.save_failed'))
      setKeepAliveMinutes(keepAliveTime)
    }
  }

  return (
    <div>
      <ProviderSettingsSubtitle className="mb-1">{t('lmstudio.keep_alive_time.title')}</ProviderSettingsSubtitle>
      <div className="w-full [&>div]:block [&>div]:w-full">
        <EditableNumber
          value={keepAliveMinutes}
          min={0}
          step={5}
          suffix={t('lmstudio.keep_alive_time.placeholder')}
          align="start"
          changeOnBlur={false}
          onChange={(v) => setKeepAliveMinutes(Math.floor(Number(v ?? 0)))}
          onBlur={() => {
            void handleBlur()
          }}
        />
      </div>
      <ProviderHelpTextRow>
        <ProviderHelpText>{t('lmstudio.keep_alive_time.description')}</ProviderHelpText>
      </ProviderHelpTextRow>
    </div>
  )
}

export default LMStudioSettings
