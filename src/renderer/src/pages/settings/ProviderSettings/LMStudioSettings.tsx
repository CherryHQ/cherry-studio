import { useLMStudioSettings } from '@renderer/hooks/useLMStudio'
import { InputNumber } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

const LMStudioSettings: FC = () => {
  const { keepAliveTime, setKeepAliveTime } = useLMStudioSettings()
  const [keepAliveMinutes, setKeepAliveMinutes] = useState(keepAliveTime)
  const { t } = useTranslation()

  return (
    <Container>
      <SettingSubtitle style={{ marginBottom: 5 }}>{t('lmstudio.keep_alive_time.title')}</SettingSubtitle>
      <InputNumber
        style={{ width: '100%' }}
        value={keepAliveMinutes}
        min={0}
        onChange={(e) => setKeepAliveMinutes(Math.floor(Number(e)))}
        onBlur={() => setKeepAliveTime(keepAliveMinutes)}
        suffix={t('lmstudio.keep_alive_time.placeholder')}
        step={5}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('lmstudio.keep_alive_time.description')}</SettingHelpText>
      </SettingHelpTextRow>
    </Container>
  )
}

const Container = styled.div``

export default LMStudioSettings
