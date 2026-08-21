import { InputGroup, InputGroupAddon, InputGroupText, InputNumber } from '@cherrystudio/ui'
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
  // `onCommit` fires once per edit with the normalized value, so the field needs
  // no local draft: a failed save leaves the saved value shown.
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
        <InputNumber value={keepAliveTime} min={0} step={5} onBlur={(v) => void handleCommit(v)} />
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
