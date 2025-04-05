import { useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Model } from '@renderer/types'
import { ConfigProvider, Flex, Tag } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const MentionModelsInput: FC<{
  selectedModels: Model[]
  onRemoveModel: (model: Model) => void
}> = ({ selectedModels, onRemoveModel }) => {
  const { providers } = useProviders()
  const { t } = useTranslation()

  const getProviderName = (model: Model) => {
    const provider = providers.find((p) => p.id === model?.provider)
    return provider ? (provider.isSystem ? t(`provider.${provider.id}`) : provider.name) : ''
  }

  return (
    <Container gap="4px 0" wrap>
      <ConfigProvider
        theme={{
          components: {
            Tag: {
              borderRadiusSM: 100
            }
          }
        }}>
        {selectedModels.map((model) => (
          <Tag
            icon={<i className="iconfont icon-at" />}
            bordered={false}
            color="processing"
            key={getModelUniqId(model)}
            closable
            onClose={() => onRemoveModel(model)}>
            {model.name} ({getProviderName(model)})
          </Tag>
        ))}
      </ConfigProvider>
    </Container>
  )
}

const Container = styled(Flex)`
  width: 100%;
  padding: 5px 15px 10px;
  i.iconfont {
    font-size: 12px;
    margin-inline-end: 7px;
  }
`

export default MentionModelsInput
