import { CheckOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { useAppSelector } from '@renderer/store'
import { Assistant, AssistantSettings } from '@renderer/types'
import { Select, SelectProps } from 'antd'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: AssistantSettings) => void
}

const AssistantKnowledgeBaseSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()

  const knowledgeState = useAppSelector((state) => state.knowledge)
  const knowledgeOptions: SelectProps['options'] = knowledgeState.bases.map((base) => ({
    label: base.name,
    value: base.id
  }))

  const onUpdate = (value) => {
    const knowledge_bases = value.map((id) => knowledgeState.bases.find((b) => b.id === id))
    const _assistant = { ...assistant, knowledge_bases }
    updateAssistant(_assistant)
  }

  return (
    <Container>
      <Box mb={8} style={{ fontWeight: 'bold' }}>
        {t('common.knowledge_base')}
      </Box>
      <Select
        mode="multiple"
        allowClear
        value={assistant.knowledge_bases?.map((b) => b.id)}
        placeholder={t('agents.add.knowledge_base.placeholder')}
        menuItemSelectedIcon={<CheckOutlined />}
        options={knowledgeOptions}
        onChange={(value) => onUpdate(value)}
        filterOption={(input, option) =>
          String(option?.label ?? '')
            .toLowerCase()
            .includes(input.toLowerCase())
        }
      />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  padding: 5px;
`

export default AssistantKnowledgeBaseSettings
