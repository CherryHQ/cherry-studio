import { type MouseEvent as ReactMouseEvent, useCallback, useRef, useState } from 'react'

import { useMutation, useInvalidateCache } from '@data/hooks/useDataApi'
import { useGroupReorder } from '@renderer/hooks/useGroups'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { ReorderKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'

import { BaseNavigator } from '../components/navigator'
import { useKnowledgePage } from '../KnowledgePageProvider'

const NAVIGATOR_DEFAULT_WIDTH = 250
const NAVIGATOR_MIN_WIDTH = 220
const NAVIGATOR_MAX_WIDTH = 360

const KnowledgePageNavigatorSection = () => {
  const {
    bases,
    groups,
    isLoading,
    contentRef,
    selectedBaseId,
    selectBase,
    openCreateGroupDialog,
    openCreateBaseDialog,
    moveBase,
    openRenameBaseDialog,
    openRenameGroupDialog,
    deleteGroup,
    deleteBase
  } = useKnowledgePage()
  const { trigger: reorderBase } = useMutation('PATCH', '/knowledge-bases/:id/order', { refresh: ['/knowledge-bases'] })
  const { reorderGroup } = useGroupReorder()
  const invalidateCache = useInvalidateCache()
  const handleReorderBase = useCallback(
    async (id: string, request: ReorderKnowledgeBaseDto) => {
      try {
        await reorderBase({ params: { id }, body: request })
      } catch (error) {
        await invalidateCache('/knowledge-bases')
        throw error
      }
    },
    [reorderBase, invalidateCache]
  )
  const handleReorderGroup = useCallback(
    async (id: string, anchor: OrderRequest) => {
      try {
        await reorderGroup(id, anchor)
      } catch (error) {
        await invalidateCache('/groups')
        throw error
      }
    },
    [reorderGroup, invalidateCache]
  )

  const [navigatorWidth, setNavigatorWidth] = useState(NAVIGATOR_DEFAULT_WIDTH)
  const contentLeftRef = useRef(0)

  const handleNavigatorResizeMove = useCallback((moveEvent: MouseEvent) => {
    const nextWidth = moveEvent.clientX - contentLeftRef.current
    setNavigatorWidth(Math.min(NAVIGATOR_MAX_WIDTH, Math.max(NAVIGATOR_MIN_WIDTH, nextWidth)))
  }, [])

  const { startResizing: startNavigatorResizeDrag } = useResizeDrag({ onMove: handleNavigatorResizeMove })

  const startNavigatorResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      contentLeftRef.current = contentRef.current?.getBoundingClientRect().left ?? 0
      startNavigatorResizeDrag(event)
    },
    [contentRef, startNavigatorResizeDrag]
  )

  return (
    <BaseNavigator
      onReorderBase={handleReorderBase}
      onReorderGroup={handleReorderGroup}
      bases={bases}
      groups={groups}
      isLoading={isLoading}
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
