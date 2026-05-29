import BaseNavigator from '../components/navigator'
import { useKnowledgePage } from '../KnowledgePageProvider'

const KnowledgePageNavigatorSection = () => {
  const {
    bases,
    groups,
    navigatorWidth,
    selectedBaseId,
    selectBase,
    openCreateGroupDialog,
    openCreateBaseDialog,
    moveBase,
    openRenameBaseDialog,
    openRenameGroupDialog,
    deleteGroup,
    deleteBase,
    startNavigatorResize
  } = useKnowledgePage()

  return (
    <BaseNavigator
      bases={bases}
      groups={groups}
      width={navigatorWidth}
      selectedBaseId={selectedBaseId}
      onSelectBase={selectBase}
      onCreateGroup={openCreateGroupDialog}
      onCreateBase={openCreateBaseDialog}
      onMoveBase={moveBase}
      onRenameBase={openRenameBaseDialog}
      onRenameGroup={openRenameGroupDialog}
      onDeleteGroup={deleteGroup}
      onDeleteBase={deleteBase}
      onResizeStart={startNavigatorResize}
    />
  )
}

export default KnowledgePageNavigatorSection
