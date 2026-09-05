import { InputGroup, InputGroupAddon, InputGroupInputNumber, InputGroupText } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import type { FC } from 'react'
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
  // `onBlur` fires once per edit with the normalized value, so the field needs no
  // local draft. It is handed back the promise, so it holds the committed value
  // until the provider query catches up; a failed save falls back to the saved one.
  const handleCommit = async (value: number | null) => {
    const next = value ?? 0
    if (next === keepAliveTime) return
    try {
      await updateProvider({ providerSettings: { ...provider?.settings, keepAliveTime: next } })
    } catch (error) {
      logger.error('Failed to save GPUStack keep alive time', { providerId, error })
      toast.error(t('settings.provider.save_failed'))
    }
  }

  return (
    <div>
      <ProviderSettingsSubtitle className="mb-1">{t('gpustack.keep_alive_time.title')}</ProviderSettingsSubtitle>
      <InputGroup>
        <InputGroupInputNumber
          aria-label={t('gpustack.keep_alive_time.title')}
          value={keepAliveTime}
          min={0}
          step={5}
          onBlur={handleCommit}
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
