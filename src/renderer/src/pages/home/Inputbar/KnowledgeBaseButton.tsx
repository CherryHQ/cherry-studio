import { FileSearchOutlined } from '@ant-design/icons'
import { useAppSelector } from '@renderer/store'
import { KnowledgeBase } from '@renderer/types'
import { Button, Popover, Tooltip } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  selectedBase?: KnowledgeBase
  onSelect: (base?: KnowledgeBase) => void
  disabled?: boolean
  ToolbarButton?: any
}

const KnowledgeBaseSelector: FC<Props> = ({ selectedBase, onSelect }) => {
  const { t } = useTranslation()
  const knowledgeState = useAppSelector((state) => state.knowledge)

  return (
    <SelectorContainer>
      {knowledgeState.bases.length === 0 ? (
        <EmptyMessage>{t('knowledge.no_bases')}</EmptyMessage>
      ) : (
        <>
          {selectedBase && (
            <Button type="link" block onClick={() => onSelect(undefined)} style={{ textAlign: 'left' }}>
              {t('knowledge.clear_selection')}
            </Button>
          )}
          {knowledgeState.bases.map((base) => (
            <Button
              key={base.id}
              type={selectedBase?.id === base.id ? 'primary' : 'text'}
              block
              onClick={() => onSelect(base)}
              style={{ textAlign: 'left' }}>
              {base.name}
            </Button>
          ))}
        </>
      )}
    </SelectorContainer>
  )
}

const KnowledgeBaseButton: FC<Props> = ({ selectedBase, onSelect, disabled, ToolbarButton }) => {
  const { t } = useTranslation()

  if (selectedBase) {
    return (
      <Tooltip placement="top" title={selectedBase.name} arrow>
        <ToolbarButton type="text" onClick={() => onSelect(undefined)}>
          <FileSearchOutlined style={{ color: selectedBase ? 'var(--color-link)' : 'var(--color-icon)' }} />
        </ToolbarButton>
      </Tooltip>
    )
  }

  return (
    <Tooltip placement="top" title={t('chat.input.knowledge_base')} arrow>
      <Popover
        placement="top"
        content={<KnowledgeBaseSelector selectedBase={selectedBase} onSelect={onSelect} />}
        overlayStyle={{ maxWidth: 400 }}
        trigger="click">
        <ToolbarButton type="text" onClick={() => selectedBase && onSelect(undefined)} disabled={disabled}>
          <FileSearchOutlined style={{ color: selectedBase ? 'var(--color-link)' : 'var(--color-icon)' }} />
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
