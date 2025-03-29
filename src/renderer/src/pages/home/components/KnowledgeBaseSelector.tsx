import { CheckOutlined, FileSearchOutlined } from '@ant-design/icons'
import { useAppSelector } from '@renderer/store'
import { KnowledgeBase } from '@renderer/types'
import { Popover, Select, SelectProps, Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  selectedBases?: KnowledgeBase[]
  onSelect: (bases: KnowledgeBase[]) => void
  disabled?: boolean
  ToolbarButton?: any
}

const KnowledgeBaseSelector: FC<Props> = ({ selectedBases, onSelect }) => {
  const { t } = useTranslation()
  const knowledgeState = useAppSelector((state) => state.knowledge)
  const knowledgeOptions: SelectProps['options'] = knowledgeState.bases.map((base) => ({
    label: base.name,
    value: base.id
  }))

  return (
    <SelectorContainer>
      {knowledgeState.bases.length === 0 ? (
        <EmptyMessage>{t('knowledge.no_bases')}</EmptyMessage>
      ) : (
        <Select
          mode="multiple"
          value={selectedBases?.map((base) => base.id)}
          allowClear
          placeholder={t('agents.add.knowledge_base.placeholder')}
          menuItemSelectedIcon={<CheckOutlined />}
          options={knowledgeOptions}
          filterOption={(input, option) =>
            String(option?.label ?? '')
              .toLowerCase()
              .includes(input.toLowerCase())
          }
          onChange={(ids) => {
            const newSelected = knowledgeState.bases.filter((base) => ids.includes(base.id))
            console.info('newSelected', newSelected)
            onSelect(newSelected)
          }}
          style={{ width: '200px' }}
        />
      )}
    </SelectorContainer>
  )
}

const KnowledgeBaseButton: FC<Props> = ({ selectedBases, onSelect, disabled, ToolbarButton }) => {
  const { t } = useTranslation()

  return (
    <Tooltip placement="top" title={t('chat.input.knowledge_base')} arrow>
      <Popover
        placement="top"
        content={<KnowledgeBaseSelector selectedBases={selectedBases} onSelect={onSelect} />}
        overlayStyle={{ maxWidth: 400 }}
        trigger="click">
        <ToolbarButton type="text" disabled={disabled}>
          <FileSearchOutlined
            style={{ color: selectedBases && selectedBases?.length > 0 ? 'var(--color-link)' : 'var(--color-icon)' }}
          />
        </ToolbarButton>
      </Popover>
    </Tooltip>
  )
}

const SelectorContainer = styled.div`
  max-height: 300px;
  overflow-y: auto;
`

const EmptyMessage = styled.div`
  padding: 8px;
`

export default KnowledgeBaseButton
