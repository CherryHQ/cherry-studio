import { DragDropContext } from '@hello-pangea/dnd'
import { useTheme } from '@renderer/context/ThemeProvider'
import SelectionToolbar from '@renderer/windows/selection/toolbar/SelectionToolbar'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { Row } from 'antd'
import { FC } from 'react'
import styled from 'styled-components'

import { SettingDivider, SettingGroup } from '../..'
import { useActionItems } from '../hooks/useSettingsActionsList'
import ActionsList from './ActionsList'
import ActionsListDivider from './ActionsListDivider'
import SelectionActionSearchModal from './SelectionActionSearchModal'
import SelectionActionUserModal from './SelectionActionUserModal'
import SettingsActionsListHeader from './SettingsActionsListHeader'

// Component for managing selection actions in settings
// Handles drag-and-drop reordering, enabling/disabling actions, and custom action management

// Props for the main component
interface SelectionActionsListProps {
  actionItems: SelectionActionItem[] | undefined // List of all available actions
  setActionItems: (items: SelectionActionItem[]) => void // Function to update action items
}

const SelectionActionsList: FC<SelectionActionsListProps> = ({ actionItems, setActionItems }) => {
  const {
    enabledItems,
    disabledItems,
    customItemsCount,
    isUserModalOpen,
    isSearchModalOpen,
    userEditingAction,
    setIsUserModalOpen,
    setIsSearchModalOpen,
    handleEditActionItem,
    handleAddNewAction,
    handleUserModalOk,
    handleSearchModalOk,
    handleDeleteActionItem,
    handleReset,
    onDragEnd,
    getSearchEngineInfo,
    MAX_CUSTOM_ITEMS,
    MAX_ENABLED_ITEMS
  } = useActionItems(actionItems, setActionItems)

  const { theme } = useTheme()

  if (!actionItems || actionItems.length === 0) {
    setActionItems(DefaultPreferences.default['feature.selection.action_items'])
  }

  return (
    <SettingGroup theme={theme}>
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
            />

            <ActionsListDivider enabledCount={enabledItems.length} maxEnabled={MAX_ENABLED_ITEMS} />

            <ActionsList
              droppableId="disabled"
              items={disabledItems}
              isLastEnabledItem={false}
              onEdit={handleEditActionItem}
              onDelete={handleDeleteActionItem}
              getSearchEngineInfo={getSearchEngineInfo}
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
