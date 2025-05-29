import type { DraggableProvided } from '@hello-pangea/dnd'
import type { ActionItem as ActionItemType } from '@renderer/types/selectionTypes'
import { Button } from 'antd'
import { Pencil, Settings2, Trash } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ActionItemProps {
  item: ActionItemType
  provided: DraggableProvided
  listType: 'enabled' | 'disabled'
  isLastEnabledItem: boolean
  onEdit: (item: ActionItemType) => void
  onDelete: (id: string) => void
  getSearchEngineInfo: (engine: string) => { icon: any; name: string } | null
}

const ActionsListItem = memo(
  ({ item, provided, listType, isLastEnabledItem, onEdit, onDelete, getSearchEngineInfo }: ActionItemProps) => {
    const { t } = useTranslation()
    const isEnabled = listType === 'enabled'

    return (
      <Item
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...(isLastEnabledItem ? {} : provided.dragHandleProps)}
        disabled={!isEnabled}
        className={isLastEnabledItem ? 'non-draggable' : ''}>
        <ItemLeft>
          <ItemIcon disabled={!isEnabled}>
            <DynamicIcon name={item.icon as any} size={16} fallback={() => <div style={{ width: 16, height: 16 }} />} />
          </ItemIcon>
          <ItemName disabled={!isEnabled}>{item.isBuiltIn ? t(item.name) : item.name}</ItemName>
          {item.id === 'search' && item.searchEngine && (
            <ItemDescription>
              {getSearchEngineInfo(item.searchEngine)?.icon}
              <span>{getSearchEngineInfo(item.searchEngine)?.name}</span>
            </ItemDescription>
          )}
        </ItemLeft>

        <ActionOperations item={item} onEdit={onEdit} onDelete={onDelete} />
      </Item>
    )
  }
)

interface ActionOperationsProps {
  item: ActionItemType
  onEdit: (item: ActionItemType) => void
  onDelete: (id: string) => void
}

const ActionOperations = memo(({ item, onEdit, onDelete }: ActionOperationsProps) => {
  if (!item.isBuiltIn) {
    return (
      <UserActionOpSection>
        <Button type="link" size="small" onClick={() => onEdit(item)}>
          <Pencil size={16} className="btn-icon-edit" />
        </Button>
        <Button type="link" size="small" danger onClick={() => onDelete(item.id)}>
          <Trash size={16} className="btn-icon-delete" />
        </Button>
      </UserActionOpSection>
    )
  }

  if (item.isBuiltIn && item.id === 'search') {
    return (
      <UserActionOpSection>
        <Button type="link" size="small" onClick={() => onEdit(item)}>
          <Settings2 size={16} className="btn-icon-edit" />
        </Button>
      </UserActionOpSection>
    )
  }

  return null
})

const Item = styled.div<{ disabled: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin-bottom: 8px;
  background-color: var(--color-bg-1);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  cursor: move;
  opacity: ${(props) => (props.disabled ? 0.8 : 1)};
  transition: background-color 0.2s ease;

  &:last-child {
    margin-bottom: 0;
  }

  &:hover {
    background-color: var(--color-bg-2);
  }

  &.non-draggable {
    cursor: default;
    background-color: var(--color-bg-2);
    position: relative;
  }
`

const ItemLeft = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
`

const ItemName = styled.span<{ disabled: boolean }>`
  margin-left: 8px;
  color: ${(props) => (props.disabled ? 'var(--color-text-3)' : 'var(--color-text-1)')};
`

const ItemIcon = styled.div<{ disabled: boolean }>`
  margin: 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${(props) => (props.disabled ? 'var(--color-text-3)' : 'var(--color-primary)')};
`

const ItemDescription = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 16px;
  font-size: 12px;
  color: var(--color-text-2);
  opacity: 0.8;
`

const UserActionOpSection = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;

  .btn-icon-edit {
    color: var(--color-text-3);

    &:hover {
      color: var(--color-primary);
    }
  }
  .btn-icon-delete {
    color: var(--color-text-3);

    &:hover {
      color: var(--color-error);
    }
  }
`

export default ActionsListItem
