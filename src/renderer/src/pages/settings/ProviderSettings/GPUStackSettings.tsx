import { dataApiService } from '@renderer/data/DataApiService'
import { useInvalidateCache, useQuery } from '@renderer/data/hooks/useDataApi'
import type { Provider } from '@shared/data/types/provider'
import { InputNumber } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingHelpText, SettingHelpTextRow, SettingSubtitle } from '..'

interface Props {
  providerId: string
}

const GPUStackSettings: FC<Props> = ({ providerId }) => {
  const { data: provider } = useQuery(`/providers/${providerId}` as any) as { data: Provider | undefined }
  const invalidate = useInvalidateCache()
  const { t } = useTranslation()

  const keepAliveTime = provider?.settings?.keepAliveTime ?? 0
  const [keepAliveMinutes, setKeepAliveMinutes] = useState(keepAliveTime)

  const handleBlur = async () => {
    if (keepAliveMinutes === keepAliveTime) return
    await dataApiService.patch(`/providers/${providerId}` as any, {
      body: { providerSettings: { ...provider?.settings, keepAliveTime: keepAliveMinutes } }
    })
    await invalidate([`/providers/${providerId}`])
  }

  return (
    <Container>
      <SettingSubtitle style={{ marginBottom: 5 }}>{t('gpustack.keep_alive_time.title')}</SettingSubtitle>
      <InputNumber
        style={{ width: '100%' }}
        value={keepAliveMinutes}
        onChange={(e) => setKeepAliveMinutes(Number(e))}
        onBlur={handleBlur}
        suffix={t('gpustack.keep_alive_time.placeholder')}
        step={5}
      />
      <SettingHelpTextRow>
        <SettingHelpText>{t('gpustack.keep_alive_time.description')}</SettingHelpText>
      </SettingHelpTextRow>
    </Container>
  )
}

const Container = styled.div``

export default GPUStackSettings
