import { CheckOutlined } from '@ant-design/icons'
import { Box } from '@cherrystudio/ui'
import { Tooltip } from '@cherrystudio/ui'
import { useAppSelector } from '@renderer/store'
import type { Assistant, AssistantSettings } from '@renderer/types'
import type { SelectProps } from 'antd'
import { Row, Segmented, Select } from 'antd'
import { CircleHelp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
    <div className="flex flex-1 flex-col overflow-hidden p-1.25">
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
        <p className="mr-1.25 font-medium">{t('assistants.settings.knowledge_base.recognition.label')}</p>
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
                    <CircleHelp className="cursor-pointer text-foreground-muted" size={15} />
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
    </div>
  )
}
export default AssistantKnowledgeBaseSettings
