import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { useSessions } from '@renderer/hooks/agents/useSessions'
import AgentSettingsPopup from '@renderer/pages/settings/AgentSettings/AgentSettingsPopup'
import { AgentLabel } from '@renderer/pages/settings/AgentSettings/shared'
import { AgentEntity } from '@renderer/types'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@renderer/ui/context-menu'
import { Bot } from 'lucide-react'
import { FC, memo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

// const logger = loggerService.withContext('AgentItem')

interface AgentItemProps {
  agent: AgentEntity
  isActive: boolean
  onDelete: (agent: AgentEntity) => void
  onPress: () => void
}

const AgentItem: FC<AgentItemProps> = ({ agent, isActive, onDelete, onPress }) => {
  const { t } = useTranslation()
  const { sessions } = useSessions(agent.id)

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger>
        <Container onClick={onPress} className={isActive ? 'active' : ''}>
          <AssistantNameRow className="name" title={agent.name ?? agent.id}>
            <AgentNameWrapper>
              <AgentLabel agent={agent} />
            </AgentNameWrapper>
          </AssistantNameRow>
          <MenuButton>
            {isActive ? <SessionCount>{sessions.length}</SessionCount> : <Bot size={12} className="text-primary" />}
          </MenuButton>
        </Container>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          key="edit"
          onClick={async () => {
            // onOpen()
            await AgentSettingsPopup.show({
              agentId: agent.id
            })
          }}>
          <EditIcon size={14} />
          {t('common.edit')}
        </ContextMenuItem>
        <ContextMenuItem
          key="delete"
          className="text-danger"
          onClick={() => {
            window.modal.confirm({
              title: t('agent.delete.title'),
              content: t('agent.delete.content'),
              centered: true,
              okButtonProps: { danger: true },
              onOk: () => onDelete(agent)
            })
          }}>
          <DeleteIcon size={14} className="lucide-custom text-danger" />
          <span className="text-danger">{t('common.delete')}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 0 8px;
  height: 37px;
  position: relative;
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid transparent;
  width: calc(var(--assistants-width) - 20px);
  cursor: pointer;

  &:hover {
    background-color: var(--color-list-item-hover);
  }
  &.active {
    background-color: var(--color-list-item);
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  }
`

const AssistantNameRow = styled.div`
  color: var(--color-text);
  font-size: 13px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
`

const AgentNameWrapper = styled.div`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const MenuButton = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  min-width: 22px;
  height: 22px;
  min-height: 22px;
  border-radius: 11px;
  position: absolute;
  background-color: var(--color-background);
  right: 9px;
  top: 6px;
  padding: 0 5px;
  border: 0.5px solid var(--color-border);
`

const SessionCount = styled.div`
  color: var(--color-text);
  font-size: 10px;
  border-radius: 10px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
`

export default memo(AgentItem)
