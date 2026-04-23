import { useGPUStackSettings } from '@renderer/hooks/useGPUStack'
import { InputNumber } from 'antd'
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
      <InputNumber
        style={{ width: '100%' }}
        value={keepAliveMinutes}
        onChange={(e) => setKeepAliveMinutes(Number(e))}
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
