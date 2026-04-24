import { EditableNumber } from '@cherrystudio/ui'
import { useLMStudioSettings } from '@renderer/hooks/useLMStudio'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

const LMStudioSettings: FC = () => {
  const { keepAliveTime, setKeepAliveTime } = useLMStudioSettings()
  const [keepAliveMinutes, setKeepAliveMinutes] = useState(keepAliveTime)
  const { t } = useTranslation()

  return (
    <div>
      <SettingSubtitle style={{ marginBottom: 5 }}>{t('lmstudio.keep_alive_time.title')}</SettingSubtitle>
      <EditableNumber
        className="w-full"
        value={keepAliveMinutes}
        min={0}
        onChange={(value) => setKeepAliveMinutes(Math.floor(Number(value)))}
        onBlur={() => setKeepAliveTime(keepAliveMinutes)}
        suffix={t('lmstudio.keep_alive_time.placeholder')}
        step={5}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('lmstudio.keep_alive_time.description')}</SettingHelpText>
      </SettingHelpTextRow>
    </div>
  )
}

export default LMStudioSettings
