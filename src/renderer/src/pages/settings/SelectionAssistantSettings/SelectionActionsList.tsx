import { DragDropContext } from '@hello-pangea/dnd'
import { defaultActionItems } from '@renderer/store/selectionStore'
import type { ActionItem } from '@renderer/types/selectionTypes'
import SelectionToolbar from '@renderer/windows/selection/toolbar/SelectionToolbar'
import { Row } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

import { SettingDivider, SettingGroup } from '..'
import ActionsList from './components/ActionsList'
import ActionsListDivider from './components/ActionsListDivider'
import SettingsActionsListHeader from './components/SettingsActionsListHeader'
import { useActionItems } from './hooks/useSettingsActionsList'
import SelectionActionSearchModal from './SelectionActionSearchModal'
import SelectionActionTTSModal from './SelectionActionTTSModal'
import SelectionActionUserModal from './SelectionActionUserModal'

// Component for managing selection actions in settings
// Handles drag-and-drop reordering, enabling/disabling actions, and custom action management

// Props for the main component
interface SelectionActionsListProps {
  actionItems: ActionItem[] | undefined // List of all available actions
  setActionItems: (items: ActionItem[]) => void // Function to update action items
}

const SelectionActionsList: FC<SelectionActionsListProps> = ({ actionItems, setActionItems }) => {
  const {
    enabledItems,
    disabledItems,
    customItemsCount,
    isUserModalOpen,
    isSearchModalOpen,
    isTTSModalOpen,
    userEditingAction,
    setIsUserModalOpen,
    setIsSearchModalOpen,
    setIsTTSModalOpen,
    handleEditActionItem,
    handleAddNewAction,
    handleUserModalOk,
    handleSearchModalOk,
    handleTTSModalOk,
    handleDeleteActionItem,
    handleReset,
    onDragEnd,
    getSearchEngineInfo,
    getTTSProviderInfo,
    MAX_CUSTOM_ITEMS,
    MAX_ENABLED_ITEMS
  } = useActionItems(actionItems, setActionItems)

  if (!actionItems || actionItems.length === 0) {
    setActionItems(defaultActionItems)
  }

  return (
    <SettingGroup>
      <SettingsActionsListHeader
        customItemsCount={customItemsCount}
        maxCustomItems={MAX_CUSTOM_ITEMS}
        onReset={handleReset}
        onAdd={handleAddNewAction}
      />

      <SettingDivider />

      <DemoSection>
        <SelectionToolbar demo />
      </DemoSection>

      <DragDropContext onDragEnd={onDragEnd}>
        <ActionsListSection>
          <ActionColumn>
            <ActionsList
              droppableId="enabled"
              items={enabledItems}
              isLastEnabledItem={enabledItems.length === 1}
              onEdit={handleEditActionItem}
              onDelete={handleDeleteActionItem}
              getSearchEngineInfo={getSearchEngineInfo}
              getTTSProviderInfo={getTTSProviderInfo}
            />

            <ActionsListDivider enabledCount={enabledItems.length} maxEnabled={MAX_ENABLED_ITEMS} />

            <ActionsList
              droppableId="disabled"
              items={disabledItems}
              isLastEnabledItem={false}
              onEdit={handleEditActionItem}
              onDelete={handleDeleteActionItem}
              getSearchEngineInfo={getSearchEngineInfo}
              getTTSProviderInfo={getTTSProviderInfo}
            />
          </ActionColumn>
        </ActionsListSection>
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

      <SelectionActionTTSModal
        isModalOpen={isTTSModalOpen}
        onOk={handleTTSModalOk}
        onCancel={() => setIsTTSModalOpen(false)}
        currentAction={actionItems?.find((item) => item.id === 'speak')}
      />
    </SettingGroup>
  )
}

const ActionsListSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ActionColumn = styled.div`
  width: 100%;
`

const DemoSection = styled(Row)`
  align-items: center;
  justify-content: center;
  margin: 24px 0;
`

export default SelectionActionsList
