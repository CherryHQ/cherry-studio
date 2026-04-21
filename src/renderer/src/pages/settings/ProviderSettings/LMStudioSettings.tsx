import { useProvider } from '@renderer/hooks/useProviders'
import { InputNumber } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

interface Props {
  providerId: string
}

const LMStudioSettings: FC<Props> = ({ providerId }) => {
  const { provider, updateProvider } = useProvider(providerId)
  const { t } = useTranslation()

  const keepAliveTime = provider?.settings?.keepAliveTime ?? 0
  const [keepAliveMinutes, setKeepAliveMinutes] = useState(keepAliveTime)

  const handleBlur = async () => {
    if (keepAliveMinutes === keepAliveTime) return
    await updateProvider({ providerSettings: { ...provider?.settings, keepAliveTime: keepAliveMinutes } })
  }

  return (
    <Container>
      <SettingSubtitle style={{ marginBottom: 5 }}>{t('lmstudio.keep_alive_time.title')}</SettingSubtitle>
      <InputNumber
        style={{ width: '100%' }}
        value={keepAliveMinutes}
        min={0}
        onChange={(e) => setKeepAliveMinutes(Math.floor(Number(e)))}
        onBlur={handleBlur}
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
