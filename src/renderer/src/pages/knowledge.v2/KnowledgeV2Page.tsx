import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BaseNavigator from './components/BaseNavigator'
import CreateKnowledgeBaseDialog from './components/CreateKnowledgeBaseDialog'
import DetailHeader from './components/DetailHeader'
import DetailTabs from './components/DetailTabs'
import KnowledgeBaseNameDialog from './components/KnowledgeBaseNameDialog'
import KnowledgeGroupNameDialog from './components/KnowledgeGroupNameDialog'
import {
  useCreateKnowledgeBase,
  useCreateKnowledgeGroup,
  useDeleteKnowledgeBase,
  useDeleteKnowledgeGroup,
  useKnowledgeBases,
  useKnowledgeGroups,
  useKnowledgeItems,
  useUpdateKnowledgeBase,
  useUpdateKnowledgeGroup
} from './hooks'
import DataSourcePanel from './panels/dataSource/DataSourcePanel'
import RagConfigPanel from './panels/ragConfig/RagConfigPanel'
import RecallTestPanel from './panels/recallTest/RecallTestPanel'
import type { KnowledgeTabKey } from './types'

const NAVIGATOR_DEFAULT_WIDTH = 180
const NAVIGATOR_MIN_WIDTH = 180
const NAVIGATOR_MAX_WIDTH = 360

type EditableKnowledgeGroup = Pick<Group, 'id' | 'name'>
type EditableKnowledgeBase = Pick<KnowledgeBase, 'id' | 'name'>

const KnowledgeV2Page = () => {
  const { t } = useTranslation()
  const { bases, isLoading } = useKnowledgeBases()
  const { groups } = useKnowledgeGroups()
  const { createGroup, isCreating: isCreatingGroup } = useCreateKnowledgeGroup()
  const { createBase, isCreating } = useCreateKnowledgeBase()
  const { updateBase, isUpdating: isUpdatingBase } = useUpdateKnowledgeBase()
  const { updateGroup, isUpdating: isUpdatingGroup } = useUpdateKnowledgeGroup()
  const { deleteBase } = useDeleteKnowledgeBase()
  const { deleteGroup } = useDeleteKnowledgeGroup()
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [editingBase, setEditingBase] = useState<EditableKnowledgeBase | null>(null)
  const [editingGroup, setEditingGroup] = useState<EditableKnowledgeGroup | null>(null)
  const [selectedBaseId, setSelectedBaseId] = useState('')
  const [pendingSelectedBaseId, setPendingSelectedBaseId] = useState<string | null>(null)
  const { items: selectedBaseItems, isLoading: isItemsLoading } = useKnowledgeItems(selectedBaseId)
  const [activeTab, setActiveTab] = useState<KnowledgeTabKey>('data')
  const [navigatorWidth, setNavigatorWidth] = useState(NAVIGATOR_DEFAULT_WIDTH)
  const isResizingRef = useRef(false)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const selectedBase = useMemo(() => {
    return bases.find((base) => base.id === selectedBaseId)
  }, [bases, selectedBaseId])

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.()
    }
  }, [])

  useEffect(() => {
    if (bases.length === 0) {
      if (!pendingSelectedBaseId && selectedBaseId) {
        setSelectedBaseId('')
      }
      return
    }

    if (pendingSelectedBaseId) {
      if (bases.some((base) => base.id === pendingSelectedBaseId)) {
        setPendingSelectedBaseId(null)
      }
      return
    }

    const hasSelectedBase = bases.some((base) => base.id === selectedBaseId)
    if (!selectedBaseId || !hasSelectedBase) {
      setSelectedBaseId(bases[0].id)
    }
  }, [bases, pendingSelectedBaseId, selectedBaseId])

  const handleSelectBase = useCallback((baseId: string) => {
    setPendingSelectedBaseId(null)
    setSelectedBaseId(baseId)
  }, [])

  const handleCreateBaseCreated = useCallback((createdBase: { id: string }) => {
    setPendingSelectedBaseId(createdBase.id)
    setSelectedBaseId(createdBase.id)
  }, [])

  const handleCreateGroupSubmit = useCallback(
    async (name: string) => {
      await createGroup(name)
      setIsCreateGroupDialogOpen(false)
    },
    [createGroup]
  )

  const handleMoveBase = useCallback(
    async (baseId: string, groupId: string) => {
      await updateBase(baseId, { groupId })
    },
    [updateBase]
  )

  const handleRenameGroup = useCallback((group: EditableKnowledgeGroup) => {
    setEditingGroup(group)
  }, [])

  const handleRenameBase = useCallback((base: EditableKnowledgeBase) => {
    setEditingBase(base)
  }, [])

  const handleRenameBaseDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingBase(null)
    }
  }, [])

  const handleRenameBaseSubmit = useCallback(
    async (name: string) => {
      if (!editingBase) {
        return
      }

      if (name === editingBase.name.trim()) {
        setEditingBase(null)
        return
      }

      await updateBase(editingBase.id, { name })
      setEditingBase(null)
    },
    [editingBase, updateBase]
  )

  const handleRenameGroupDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingGroup(null)
    }
  }, [])

  const handleRenameGroupSubmit = useCallback(
    async (name: string) => {
      if (!editingGroup) {
        return
      }

      if (name === editingGroup.name.trim()) {
        setEditingGroup(null)
        return
      }

      await updateGroup(editingGroup.id, { name })
      setEditingGroup(null)
    },
    [editingGroup, updateGroup]
  )

  const handleDeleteBase = useCallback(
    async (baseId: string) => {
      await deleteBase(baseId)
    },
    [deleteBase]
  )

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      await deleteGroup(groupId)
    },
    [deleteGroup]
  )

  const startNavigatorResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    isResizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const containerLeft = contentRef.current?.getBoundingClientRect().left ?? 0

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) {
        return
      }

      const nextWidth = moveEvent.clientX - containerLeft
      setNavigatorWidth(Math.min(NAVIGATOR_MAX_WIDTH, Math.max(NAVIGATOR_MIN_WIDTH, nextWidth)))
    }

    const cleanup = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      resizeCleanupRef.current = null
    }

    const onMouseUp = () => cleanup()

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    resizeCleanupRef.current = cleanup
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('knowledge_v2.title')}</NavbarCenter>
      </Navbar>

      <div
        ref={contentRef}
        className="flex h-[calc(100vh-var(--navbar-height))] min-h-0 flex-1 overflow-hidden bg-background">
        <BaseNavigator
          bases={bases}
          groups={groups}
          width={navigatorWidth}
          selectedBaseId={selectedBaseId}
          onSelectBase={handleSelectBase}
          onCreateGroup={() => setIsCreateGroupDialogOpen(true)}
          onCreateBase={() => setIsCreateDialogOpen(true)}
          onMoveBase={handleMoveBase}
          onRenameBase={handleRenameBase}
          onRenameGroup={handleRenameGroup}
          onDeleteGroup={handleDeleteGroup}
          onDeleteBase={handleDeleteBase}
          onResizeStart={startNavigatorResize}
        />

        {selectedBase ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
            <DetailHeader base={selectedBase} onRenameBase={handleRenameBase} />
            <DetailTabs activeTab={activeTab} dataSourceCount={selectedBaseItems.length} onChange={setActiveTab} />

            <div className="min-h-0 flex-1 overflow-hidden">
              {activeTab === 'data' && <DataSourcePanel items={selectedBaseItems} isLoading={isItemsLoading} />}
              {activeTab === 'rag' && <RagConfigPanel base={selectedBase} />}
              {activeTab === 'recall' && <RecallTestPanel />}
            </div>
          </main>
        ) : (
          <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background px-6 text-muted-foreground text-sm">
            {isLoading ? t('common.loading') : t('knowledge_v2.empty')}
          </main>
        )}
      </div>

      {isCreateGroupDialogOpen && (
        <KnowledgeGroupNameDialog
          mode="create"
          open={isCreateGroupDialogOpen}
          isSubmitting={isCreatingGroup}
          onSubmit={handleCreateGroupSubmit}
          onOpenChange={setIsCreateGroupDialogOpen}
        />
      )}

      {editingGroup && (
        <KnowledgeGroupNameDialog
          mode="update"
          open
          initialName={editingGroup.name}
          isSubmitting={isUpdatingGroup}
          onSubmit={handleRenameGroupSubmit}
          onOpenChange={handleRenameGroupDialogOpenChange}
        />
      )}

      {editingBase && (
        <KnowledgeBaseNameDialog
          open
          initialName={editingBase.name}
          isSubmitting={isUpdatingBase}
          onSubmit={handleRenameBaseSubmit}
          onOpenChange={handleRenameBaseDialogOpenChange}
        />
      )}

      {isCreateDialogOpen && (
        <CreateKnowledgeBaseDialog
          open={isCreateDialogOpen}
          groups={groups}
          isCreating={isCreating}
          createBase={createBase}
          onOpenChange={setIsCreateDialogOpen}
          onCreated={handleCreateBaseCreated}
        />
      )}
    </div>
  )
}

export default KnowledgeV2Page
