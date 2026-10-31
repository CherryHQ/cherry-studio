import type { FC } from 'react'

import { ReorderableList } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import SelectionToolbarView from '@renderer/components/selection/SelectionToolbarView'
import { SettingDivider, SettingGroup } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

import { ACTIONS_DIVIDER, type ActionRow, useActionItems } from '../hooks/useSettingsActionsList'
import ActionsListDivider from './ActionsListDivider'
import ActionsListItem from './ActionsListItem'
import SelectionActionModelSettings from './SelectionActionModelSettings'
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

const getActionRowId = (row: ActionRow) => (row === ACTIONS_DIVIDER ? ACTIONS_DIVIDER : row.id)

const SelectionActionsList: FC<SelectionActionsListProps> = ({ actionItems, setActionItems }) => {
  const {
    enabledItems,
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
    actionRows,
    handleReorderRows,
    getSearchEngineInfo,
    MAX_CUSTOM_ITEMS,
    MAX_ENABLED_ITEMS
  } = useActionItems(actionItems, setActionItems)

  const { theme } = useTheme()
  const [isCompact] = usePreference('feature.selection.compact')

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

      <SelectionActionModelSettings />

      <div className="my-6 flex items-center justify-center">
        <SelectionToolbarView
          actionItems={actionItems?.filter((item) => item.enabled) ?? []}
          isCompact={isCompact}
          handleAction={() => {}}
          copyIconStatus="normal"
          copyIconAnimation="none"
        />
      </div>

      <ReorderableList
        items={actionRows}
        getId={getActionRowId}
        onReorder={handleReorderRows}
        isItemDragDisabled={(row) => row === ACTIONS_DIVIDER || (row.enabled && enabledItems.length === 1)}
        gap={8}
        itemStyle={{ cursor: 'default' }}
        className="mb-4"
        renderItem={(row) =>
          row === ACTIONS_DIVIDER ? (
            <ActionsListDivider enabledCount={enabledItems.length} maxEnabled={MAX_ENABLED_ITEMS} />
          ) : (
            <ActionsListItem
              item={row}
              isLastEnabledItem={row.enabled && enabledItems.length === 1}
              onEdit={handleEditActionItem}
              onDelete={handleDeleteActionItem}
              getSearchEngineInfo={getSearchEngineInfo}
            />
          )
        }
      />

      {isUserModalOpen && (
        <SelectionActionUserModal
          isModalOpen={isUserModalOpen}
          editingAction={userEditingAction}
          onOk={handleUserModalOk}
          onCancel={() => setIsUserModalOpen(false)}
        />
      )}

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
