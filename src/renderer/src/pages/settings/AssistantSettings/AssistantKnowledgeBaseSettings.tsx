import { CheckOutlined } from '@ant-design/icons'
import { Box } from '@cherrystudio/ui'
import { Tooltip } from '@cherrystudio/ui'
// import { listKnowledgeBases, toLegacyKnowledgeBase } from '@renderer/services/KnowledgeV2Service'
import type { Assistant, AssistantSettings } from '@renderer/types'
import type { SelectProps } from 'antd'
import { Row, Segmented, Select } from 'antd'
import { CircleHelp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  assistant: Assistant
  updateAssistant: (assistant: Assistant) => void
  updateAssistantSettings: (settings: AssistantSettings) => void
}

const AssistantKnowledgeBaseSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()
  const [knowledgeBases] = useState<Assistant['knowledge_bases']>([])

  // Knowledge V2 base loading is temporarily disabled while KnowledgeV2Service is removed.
  // useEffect(() => {
  //   let disposed = false
  //
  //   listKnowledgeBases()
  //     .then((bases) => {
  //       if (!disposed) {
  //         setKnowledgeBases(bases.map(toLegacyKnowledgeBase))
  //       }
  //     })
  //     .catch(() => {
  //       if (!disposed) {
  //         setKnowledgeBases([])
  //       }
  //     })
  //
  //   return () => {
  //     disposed = true
  //   }
  // }, [])

  const knowledgeOptions: SelectProps['options'] = knowledgeBases?.map((base) => ({
    label: base.name,
    value: base.id
  }))

  const onUpdate = (value) => {
    const knowledge_bases = value.map((id) => knowledgeBases?.find((base) => base.id === id))
    const _assistant = { ...assistant, knowledge_bases }
    updateAssistant(_assistant)
  }

  return (
    <Container>
      <Box className="mb-2 font-bold">{t('common.knowledge_base')}</Box>
      <Select
        mode="multiple"
        allowClear
        value={assistant.knowledge_bases?.map((b) => b.id)}
        placeholder={t('assistants.presets.add.knowledge_base.placeholder')}
        menuItemSelectedIcon={<CheckOutlined />}
        options={knowledgeOptions}
        onChange={(value) => onUpdate(value)}
        filterOption={(input, option) =>
          String(option?.label ?? '')
            .toLowerCase()
            .includes(input.toLowerCase())
        }
      />
      <Row align="middle" style={{ marginTop: 10 }}>
        <Label>{t('assistants.settings.knowledge_base.recognition.label')}</Label>
      </Row>
      <Row align="middle" style={{ marginTop: 10 }}>
        <Segmented
          value={assistant.knowledgeRecognition ?? 'off'}
          options={[
            { label: t('assistants.settings.knowledge_base.recognition.off'), value: 'off' },
            {
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {t('assistants.settings.knowledge_base.recognition.on')}
                  <Tooltip content={t('assistants.settings.knowledge_base.recognition.tip')}>
                    <QuestionIcon size={15} />
                  </Tooltip>
                </div>
              ),
              value: 'on'
            }
          ]}
          onChange={(value) =>
            updateAssistant({
              ...assistant,
              knowledgeRecognition: value as 'off' | 'on'
            })
          }
        />
      </Row>
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
const Label = styled.p`
  margin-right: 5px;
  font-weight: 500;
`

const QuestionIcon = styled(CircleHelp)`
  cursor: pointer;
  color: var(--color-text-3);
`
export default AssistantKnowledgeBaseSettings
