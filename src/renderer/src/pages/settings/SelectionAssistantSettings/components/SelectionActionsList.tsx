import { DragDropContext } from '@hello-pangea/dnd'
import { useTheme } from '@renderer/context/ThemeProvider'
import SelectionToolbar from '@renderer/windows/selection/toolbar/SelectionToolbar'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'

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

      <div className="my-6 flex items-center justify-center">
        <SelectionToolbar demo />
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex flex-col gap-4">
          <div className="w-full">
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
          </div>
        </div>
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

export default SelectionActionsList
