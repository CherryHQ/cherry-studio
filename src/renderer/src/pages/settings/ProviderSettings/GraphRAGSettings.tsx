import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { MinAppType, Provider } from '@renderer/types'
import { Button } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingSubtitle } from '..'

interface Props {
  provider: Provider
}

const GraphRAGSettings: FC<Props> = ({ provider }) => {
  const apiUrl = provider.apiHost
  const modalId = provider.models.filter((model) => model.id.includes('global'))[0]?.id
  const { t } = useTranslation()
  const { openMinapp } = useMinappPopup()

  const onShowGraphRAG = async () => {
    const { appPath } = await window.api.getAppInfo()
    const url = `file://${appPath}/resources/graphrag.html?apiUrl=${apiUrl}&modelId=${modalId}`

    const app: MinAppType = {
      id: 'graphrag',
      name: t('words.knowledgeGraph'),
      logo: '',
      url
    }

    openMinapp(app)
  }

  if (!modalId) {
    return null
  }

  return (
    <Container>
      <SettingSubtitle>{t('words.knowledgeGraph')}</SettingSubtitle>
      <Button style={{ marginTop: 10 }} onClick={onShowGraphRAG}>
        {t('words.visualization')}
      </Button>
    </Container>
  )
}

const Container = styled.div``

export default GraphRAGSettings
