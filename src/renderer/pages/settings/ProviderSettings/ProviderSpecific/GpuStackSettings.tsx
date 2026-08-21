import { InputGroup, InputGroupAddon, InputGroupText, InputNumber } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ProviderHelpText,
  ProviderHelpTextRow,
  ProviderSettingsSubtitle
} from '../primitives/ProviderSettingsPrimitives'

const logger = loggerService.withContext('GpuStackSettings')

interface Props {
  providerId: string
}

const GpuStackSettings: FC<Props> = ({ providerId }) => {
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
      logger.error('Failed to save GPUStack keep alive time', { providerId, error })
      toast.error(t('settings.provider.save_failed'))
      setKeepAliveMinutes(keepAliveTime)
    }
  }

  return (
    <div>
      <ProviderSettingsSubtitle className="mb-1">{t('gpustack.keep_alive_time.title')}</ProviderSettingsSubtitle>
      <InputGroup>
        <InputNumber
          value={keepAliveMinutes}
          min={0}
          step={5}
          onChange={(v) => setKeepAliveMinutes(Number(v ?? 0))}
          onBlur={() => {
            void handleBlur()
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{t('gpustack.keep_alive_time.placeholder')}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <ProviderHelpTextRow>
        <ProviderHelpText>{t('gpustack.keep_alive_time.description')}</ProviderHelpText>
      </ProviderHelpTextRow>
    </div>
  )
}

export default GpuStackSettings
