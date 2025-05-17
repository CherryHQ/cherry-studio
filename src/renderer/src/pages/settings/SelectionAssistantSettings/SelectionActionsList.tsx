import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  Droppable,
  DroppableProvided,
  DropResult
} from '@hello-pangea/dnd'
import { defaultActionItems } from '@renderer/store/selectionStore'
import type { ActionItem } from '@renderer/types/selectionTypes'
import SelectionToolbar from '@renderer/windows/selection/toolbar/SelectionToolbar'
import { Button, Row, Tooltip } from 'antd'
import { MessageSquareHeart, Pencil, Plus, Settings2, Trash } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import React, { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDivider, SettingGroup, SettingTitle } from '..'
import SelectionActionSearchModal, { DEFAULT_SEARCH_ENGINES } from './SelectionActionSearchModal'
import SelectionActionUserModal from './SelectionActionUserModal'

// Component for managing selection actions in settings
// Handles drag-and-drop reordering, enabling/disabling actions, and custom action management

// Props for the main component
interface SelectionActionsListProps {
  actionItems: ActionItem[] | undefined // List of all available actions
  setActionItems: (items: ActionItem[]) => void // Function to update action items
}

// Props for individual action item component
interface ActionItemComponentProps {
  item: ActionItem // The action item to display
  provided: DraggableProvided // Drag and drop props
  listType: 'enabled' | 'disabled' // Which list the item belongs to
  isLastEnabledItem: boolean // Whether this is the last enabled item
}

// Props for droppable list component
interface DroppableListProps {
  droppableId: 'enabled' | 'disabled' // Identifier for the droppable area
  items: ActionItem[] // Items to display in the list
}

const SelectionActionsList: FC<SelectionActionsListProps> = ({ actionItems, setActionItems }): React.ReactElement => {
  const { t } = useTranslation()

  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [userEditingAction, setUserEditingAction] = useState<ActionItem | null>(null)

  // Constants for action management
  const MAX_CUSTOM_ITEMS = 5 // Maximum number of custom actions allowed
  const MAX_ENABLED_ITEMS = 5 // Maximum number of enabled actions allowed

  // Reset actions to default state, preserving custom items but disabling them
  const handleReset = () => {
    if (!actionItems) return

    window.modal.confirm({
      centered: true,
      content: t('selection.settings.actions.reset.confirm'),
      onOk: () => {
        // Get all user custom items and set them as disabled
        const userItems = actionItems.filter((item) => !item.isBuiltIn).map((item) => ({ ...item, enabled: false }))

        // Merge initial built-in items with user custom items
        setActionItems([...defaultActionItems, ...userItems])
      }
    })
  }

  // Memoized lists of enabled and disabled actions
  const enabledItems = useMemo(() => {
    if (!actionItems) return []
    // Get all enabled items
    return actionItems.filter((item) => item.enabled)
  }, [actionItems])

  const disabledItems = useMemo(() => {
    if (!actionItems) return []
    // Get all disabled items
    return actionItems.filter((item) => !item.enabled)
  }, [actionItems])

  // Count of custom (non-built-in) actions
  const customItemsCount = useMemo(() => {
    if (!actionItems) return 0
    return actionItems.filter((item) => !item.isBuiltIn).length
  }, [actionItems])

  // Handle editing of action items
  // Built-in items can only be configured (like search), custom items can be fully edited
  const handleEditActionItem = (item: ActionItem) => {
    if (item.isBuiltIn) {
      if (item.id === 'search') {
        setIsSearchModalOpen(true)
        return
      }
      return
    }
    setUserEditingAction(item)
    setIsUserModalOpen(true)
  }

  // Add a new custom action if under the limit
  const handleAddNewAction = () => {
    if (isCustomItemLimitReached) return

    setUserEditingAction(null)
    setIsUserModalOpen(true)
  }

  // Update or add a custom action
  const handleUserModalOk = (actionItem: ActionItem) => {
    if (userEditingAction && actionItems) {
      // Update existing item
      const updatedItems = actionItems.map((item) => (item.id === userEditingAction.id ? actionItem : item))
      setActionItems(updatedItems)
    } else {
      // Add new item
      try {
        const currentItems = actionItems || []
        setActionItems([...currentItems, actionItem])
      } catch (error) {
        console.error('Error adding item:', error)
      }
    }

    setIsUserModalOpen(false)
  }

  // Update search engine configuration
  const handleSearchModalOk = (searchEngine: string) => {
    if (!actionItems) return

    const updatedItems = actionItems.map((item) => (item.id === 'search' ? { ...item, searchEngine } : item))
    setActionItems(updatedItems)
    setIsSearchModalOpen(false)
  }

  // Delete a custom action after confirmation
  const handleDeleteActionItem = (id: string) => {
    if (!actionItems) return

    window.modal.confirm({
      centered: true,
      content: t('selection.settings.actions.delete_confirm'),
      onOk: () => {
        setActionItems(actionItems.filter((item) => item.id !== id))
      }
    })
  }

  // Handle drag and drop operations
  // Manages reordering within lists and moving items between enabled/disabled lists
  // Enforces maximum enabled items limit
  const onDragEnd = (result: DropResult) => {
    if (!result.destination || !actionItems) return

    const { source, destination } = result

    // Check if trying to move the last enabled item to disabled list
    if (source.droppableId === 'enabled' && destination.droppableId === 'disabled' && enabledItems.length === 1) {
      return // Prevent operation
    }

    if (source.droppableId === destination.droppableId) {
      // Reorder within the same list
      const list = source.droppableId === 'enabled' ? [...enabledItems] : [...disabledItems]
      const [removed] = list.splice(source.index, 1)
      list.splice(destination.index, 0, removed)

      if (source.droppableId === 'enabled') {
        // If list exceeds limit, move excess items to disabled list
        const limitedEnabledItems = list.slice(0, MAX_ENABLED_ITEMS)
        const overflowItems = list.length > MAX_ENABLED_ITEMS ? list.slice(MAX_ENABLED_ITEMS) : []

        // Merge updated two lists
        const updatedItems = [
          ...limitedEnabledItems.map((item) => ({ ...item, enabled: true })),
          ...disabledItems,
          ...overflowItems.map((item) => ({ ...item, enabled: false }))
        ]

        setActionItems(updatedItems)
      } else {
        // Update disabled list order
        const updatedItems = [...enabledItems, ...list]

        setActionItems(updatedItems)
      }
      return
    }

    // Move between lists
    const sourceList = source.droppableId === 'enabled' ? [...enabledItems] : [...disabledItems]
    const destList = destination.droppableId === 'enabled' ? [...enabledItems] : [...disabledItems]

    // Remove item from source list
    const [removed] = sourceList.splice(source.index, 1)
    // Update item enabled state
    const updatedItem = { ...removed, enabled: destination.droppableId === 'enabled' }

    // Ensure target list does not contain duplicate items
    const filteredDestList = destList.filter((item) => item.id !== updatedItem.id)
    // Insert item at target position
    filteredDestList.splice(destination.index, 0, updatedItem)

    // Determine updated enabled and disabled lists
    let newEnabledItems = destination.droppableId === 'enabled' ? filteredDestList : sourceList
    let newDisabledItems = destination.droppableId === 'disabled' ? filteredDestList : sourceList

    // Check enabled list exceeds limit
    if (newEnabledItems.length > MAX_ENABLED_ITEMS) {
      const overflowItems = newEnabledItems.slice(MAX_ENABLED_ITEMS).map((item) => ({ ...item, enabled: false }))
      newEnabledItems = newEnabledItems.slice(0, MAX_ENABLED_ITEMS)
      newDisabledItems = [...newDisabledItems, ...overflowItems]
    }

    // Merge updated two lists
    const updatedItems = [
      ...newEnabledItems.map((item) => ({ ...item, enabled: true })),
      ...newDisabledItems.map((item) => ({ ...item, enabled: false }))
    ]

    setActionItems(updatedItems)
  }

  // Get search engine information for display
  const getSearchEngineInfo = (searchEngine: string) => {
    if (!searchEngine) return null
    const [engine] = searchEngine.split('|')
    const defaultEngine = DEFAULT_SEARCH_ENGINES.find((e) => e.value === engine)
    if (defaultEngine) {
      return { icon: defaultEngine.icon, name: defaultEngine.label }
    }
    // If custom search engine, use custom icon from DEFAULT_SEARCH_ENGINES
    const customEngine = DEFAULT_SEARCH_ENGINES.find((e) => e.value === 'custom')
    return { icon: customEngine?.icon, name: engine }
  }

  // Memoized component for rendering action icons
  const ActionIcon = React.memo(({ icon }: { icon: string | undefined }) => {
    return icon ? (
      <DynamicIcon name={icon as any} size={16} fallback={() => <div style={{ width: 16, height: 16 }} />} />
    ) : (
      <MessageSquareHeart size={16} />
    )
  })

  // Memoized component for rendering individual action items
  const ActionItemComponent = React.memo<ActionItemComponentProps>(
    ({ item, provided, listType, isLastEnabledItem }) => {
      const isEnabled = listType === 'enabled'

      return (
        <ActionListItem
          key={item.id}
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...(isLastEnabledItem ? {} : provided.dragHandleProps)}
          disabled={!isEnabled}
          className={isLastEnabledItem ? 'non-draggable' : ''}>
          <ActionListItemLeft>
            <ActionListItemIcon disabled={!isEnabled}>
              <ActionIcon icon={item.icon} />
            </ActionListItemIcon>
            <ActionListItemName disabled={!isEnabled}>{item.isBuiltIn ? t(item.name) : item.name}</ActionListItemName>
            {item.id === 'search' && item.searchEngine && (
              <ActionListItemDescription>
                {getSearchEngineInfo(item.searchEngine)?.icon}
                <span>{getSearchEngineInfo(item.searchEngine)?.name}</span>
              </ActionListItemDescription>
            )}
          </ActionListItemLeft>
          {!item.isBuiltIn && (
            <UserActionOpSection>
              <Button type="link" size="small" onClick={() => handleEditActionItem(item)}>
                <Pencil size={16} className="btn-icon-edit" />
              </Button>
              <Button type="link" size="small" danger onClick={() => handleDeleteActionItem(item.id)}>
                <Trash size={16} className="btn-icon-delete" />
              </Button>
            </UserActionOpSection>
          )}
          {item.isBuiltIn && item.id === 'search' && (
            <UserActionOpSection>
              <Button type="link" size="small" onClick={() => handleEditActionItem(item)}>
                <Settings2 size={16} className="btn-icon-edit" />
              </Button>
            </UserActionOpSection>
          )}
        </ActionListItem>
      )
    }
  )

  // Component for droppable action lists (enabled/disabled)
  const DroppableList: FC<DroppableListProps> = ({ droppableId, items }) => {
    return (
      <Droppable droppableId={droppableId}>
        {(provided: DroppableProvided) => (
          <ActionsList ref={provided.innerRef} {...provided.droppableProps}>
            <ActionsListContent>
              {items.map((item, index) => (
                <Draggable key={`${droppableId}-${item.id}`} draggableId={item.id} index={index}>
                  {(provided: DraggableProvided) => (
                    <ActionItemComponent
                      key={`actionItem-${item.id}`}
                      item={item}
                      provided={provided}
                      listType={droppableId}
                      isLastEnabledItem={droppableId === 'enabled' && enabledItems.length === 1}
                    />
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </ActionsListContent>
          </ActionsList>
        )}
      </Droppable>
    )
  }

  // Check if custom item limit is reached
  const isCustomItemLimitReached = customItemsCount >= MAX_CUSTOM_ITEMS

  if (!actionItems || actionItems.length === 0) {
    setActionItems(defaultActionItems)
  }

  return (
    <SettingGroup>
      <Row>
        <SettingTitle>{t('selection.settings.actions.title')}</SettingTitle>
        <Spacer />
        <Tooltip title={t('selection.settings.actions.reset.tooltip')}>
          <ResetButton type="text" onClick={handleReset}>
            {t('selection.settings.actions.reset.button')}
          </ResetButton>
        </Tooltip>
        <Tooltip
          title={
            isCustomItemLimitReached
              ? t('selection.settings.actions.add_tooltip.disabled', { max: MAX_CUSTOM_ITEMS })
              : t('selection.settings.actions.add_tooltip.enabled')
          }>
          <Button
            type="primary"
            icon={<Plus size={16} />}
            onClick={handleAddNewAction}
            disabled={isCustomItemLimitReached}
          />
        </Tooltip>
      </Row>
      <SettingDivider />
      <Row align="middle" justify="center" style={{ margin: '24px 0' }}>
        <SelectionToolbar demo />
      </Row>

      <DragDropContext onDragEnd={onDragEnd}>
        <ActionListSection>
          <ActionColumn>
            <DroppableList droppableId="enabled" items={enabledItems} />

            <DividerContainer>
              <DividerLine />
              <DividerText>
                {t('selection.settings.actions.drag_hint', { enabled: enabledItems.length, max: MAX_ENABLED_ITEMS })}
              </DividerText>
              <DividerLine />
            </DividerContainer>

            <DroppableList droppableId="disabled" items={disabledItems} />
          </ActionColumn>
        </ActionListSection>
      </DragDropContext>

      <SelectionActionUserModal
        isModalOpen={isUserModalOpen}
        editingAction={userEditingAction}
        onOk={handleUserModalOk}
        onCancel={() => setIsUserModalOpen(false)}
      />

      <SelectionActionSearchModal
        isModalOpen={isSearchModalOpen}
        onOk={handleSearchModalOk}
        onCancel={() => setIsSearchModalOpen(false)}
        currentAction={actionItems?.find((item) => item.id === 'search')}
      />
    </SettingGroup>
  )
}

const ActionListSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ActionColumn = styled.div`
  width: 100%;
`

const ActionsList = styled.div`
  background: var(--color-bg-1);
  border-radius: 4px;
  margin-bottom: 16px;
  padding-bottom: 1px;
`

const ActionsListContent = styled.div`
  padding: 10px;
`

const ActionListItem = styled.div<{ disabled: boolean }>`
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

  .drag-handle {
    cursor: grab;
    color: var(--color-text-3);
    transition: color 0.2s;

    &:hover,
    &:active {
      color: var(--color-primary);
    }
  }

  &:active .drag-handle {
    cursor: grabbing;
  }
`

const ActionListItemLeft = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
`

const ActionListItemName = styled.span<{ disabled: boolean }>`
  margin-left: 8px;
  color: ${(props) => (props.disabled ? 'var(--color-text-3)' : 'var(--color-text-1)')};
`

const ActionListItemIcon = styled.div<{ disabled: boolean }>`
  margin: 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${(props) => (props.disabled ? 'var(--color-text-3)' : 'var(--color-primary)')};
`

const ResetButton = styled(Button)`
  margin: 0 8px;
  color: var(--color-text-3);
  &:hover {
    color: var(--color-primary);
  }
`

const Spacer = styled.div`
  flex: 1;
`

const DividerContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--color-text-3);
  margin: 16px 12px;
`

const DividerLine = styled.div`
  flex: 1;
  height: 2px;
  background: var(--color-border);
`

const DividerText = styled.span`
  margin: 0 16px;
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

const ActionListItemDescription = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 16px;
  font-size: 12px;
  color: var(--color-text-2);
  opacity: 0.8;
`

export default SelectionActionsList
