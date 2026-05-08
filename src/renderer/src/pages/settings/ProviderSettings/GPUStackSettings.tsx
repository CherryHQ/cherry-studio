import { EditableNumber } from '@cherrystudio/ui'
import { useGPUStackSettings } from '@renderer/hooks/useGPUStack'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

const GPUStackSettings: FC = () => {
  const { keepAliveTime, setKeepAliveTime } = useGPUStackSettings()
  const [keepAliveMinutes, setKeepAliveMinutes] = useState(keepAliveTime)
  const { t } = useTranslation()

  return (
    <div>
      <SettingSubtitle style={{ marginBottom: 5 }}>{t('gpustack.keep_alive_time.title')}</SettingSubtitle>
      <EditableNumber
        className="w-full"
        value={keepAliveMinutes}
        onChange={(value) => setKeepAliveMinutes(Number(value))}
        onBlur={() => setKeepAliveTime(keepAliveMinutes)}
        suffix={t('gpustack.keep_alive_time.placeholder')}
        step={5}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('gpustack.keep_alive_time.description')}</SettingHelpText>
      </SettingHelpTextRow>
    </div>
  )
}

export default GPUStackSettings
