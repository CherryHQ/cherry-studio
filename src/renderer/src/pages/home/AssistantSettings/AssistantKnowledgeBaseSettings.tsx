import { CheckOutlined } from '@ant-design/icons'
import { Box } from '@cherrystudio/ui'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBaseDataApi'
import type { Assistant, AssistantSettings } from '@renderer/types'
import type { UpdateAssistantDto } from '@shared/data/api/schemas/assistants'
import type { SelectProps } from 'antd'
import { Select } from 'antd'
import { useTranslation } from 'react-i18next'

interface Props {
  assistant: Assistant
  updateAssistant: (patch: UpdateAssistantDto) => void
  updateAssistantSettings: (settings: AssistantSettings) => void
}

const AssistantKnowledgeBaseSettings: React.FC<Props> = ({ assistant, updateAssistant }) => {
  const { t } = useTranslation()

  const { knowledgeBases } = useKnowledgeBases()
  const knowledgeOptions: SelectProps['options'] = knowledgeBases.map((base) => ({
    label: base.name,
    value: base.id
  }))

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-[5px]">
      <Box className="mb-2 font-bold">{t('common.knowledge_base')}</Box>
      <Select
        mode="multiple"
        allowClear
        value={assistant.knowledgeBaseIds}
        placeholder={t('assistants.presets.add.knowledge_base.placeholder')}
        menuItemSelectedIcon={<CheckOutlined />}
        options={knowledgeOptions}
        onChange={(value: string[]) => updateAssistant({ knowledgeBaseIds: value })}
        filterOption={(input, option) =>
          String(option?.label ?? '')
            .toLowerCase()
            .includes(input.toLowerCase())
        }
      />
    </div>
  )
}

export default AssistantKnowledgeBaseSettings
