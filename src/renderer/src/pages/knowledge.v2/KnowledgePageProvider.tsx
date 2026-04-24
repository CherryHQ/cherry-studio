import type { Group } from '@shared/data/types/group'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  type PropsWithChildren,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

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
import type { KnowledgeTabKey } from './types'

const NAVIGATOR_DEFAULT_WIDTH = 180
const NAVIGATOR_MIN_WIDTH = 180
const NAVIGATOR_MAX_WIDTH = 360

type EditableKnowledgeGroup = Pick<Group, 'id' | 'name'>
type EditableKnowledgeBase = Pick<KnowledgeBase, 'id' | 'name'>
type KnowledgeBaseItems = ReturnType<typeof useKnowledgeItems>['items']
type CreateKnowledgeBase = ReturnType<typeof useCreateKnowledgeBase>['createBase']

interface KnowledgePageContextValue {
  bases: KnowledgeBase[]
  groups: Group[]
  isLoading: boolean
  selectedBase: KnowledgeBase | undefined
  selectedBaseId: string
  selectedBaseItems: KnowledgeBaseItems
  isItemsLoading: boolean
  activeTab: KnowledgeTabKey
  navigatorWidth: number
  contentRef: RefObject<HTMLDivElement | null>
  editingBase: EditableKnowledgeBase | null
  editingGroup: EditableKnowledgeGroup | null
  isAddSourceDialogOpen: boolean
  isCreateBaseDialogOpen: boolean
  isCreateGroupDialogOpen: boolean
  createBaseInitialGroupId: string | undefined
  isCreatingBase: boolean
  isCreatingGroup: boolean
  isUpdatingBase: boolean
  isUpdatingGroup: boolean
  createBase: CreateKnowledgeBase
  selectBase: (baseId: string) => void
  setActiveTab: (tab: KnowledgeTabKey) => void
  openAddSourceDialog: () => void
  openCreateBaseDialog: (groupId?: string) => void
  openCreateGroupDialog: () => void
  openRenameBaseDialog: (base: EditableKnowledgeBase) => void
  openRenameGroupDialog: (group: EditableKnowledgeGroup) => void
  handleAddSourceDialogOpenChange: (open: boolean) => void
  handleCreateBaseDialogOpenChange: (open: boolean) => void
  handleCreateGroupDialogOpenChange: (open: boolean) => void
  handleRenameBaseDialogOpenChange: (open: boolean) => void
  handleRenameGroupDialogOpenChange: (open: boolean) => void
  handleCreateBaseCreated: (createdBase: { id: string }) => void
  submitCreateGroup: (name: string) => Promise<void>
  submitRenameBase: (name: string) => Promise<void>
  submitRenameGroup: (name: string) => Promise<void>
  moveBase: (baseId: string, groupId: string) => Promise<void>
  deleteBase: (baseId: string) => Promise<void>
  deleteGroup: (groupId: string) => Promise<void>
  startNavigatorResize: (event: ReactMouseEvent<HTMLDivElement>) => void
}

const KnowledgePageContext = createContext<KnowledgePageContextValue | null>(null)

export const KnowledgePageProvider = ({ children }: PropsWithChildren) => {
  const { bases, isLoading } = useKnowledgeBases()
  const { groups } = useKnowledgeGroups()
  const { createGroup, isCreating: isCreatingGroup } = useCreateKnowledgeGroup()
  const { createBase, isCreating: isCreatingBase } = useCreateKnowledgeBase()
  const { updateBase, isUpdating: isUpdatingBase } = useUpdateKnowledgeBase()
  const { updateGroup, isUpdating: isUpdatingGroup } = useUpdateKnowledgeGroup()
  const { deleteBase } = useDeleteKnowledgeBase()
  const { deleteGroup } = useDeleteKnowledgeGroup()
  const [selectedBaseId, setSelectedBaseId] = useState('')
  const [pendingSelectedBaseId, setPendingSelectedBaseId] = useState<string | null>(null)
  const { items: selectedBaseItems, isLoading: isItemsLoading } = useKnowledgeItems(selectedBaseId)
  const [activeTab, setActiveTab] = useState<KnowledgeTabKey>('data')
  const [navigatorWidth, setNavigatorWidth] = useState(NAVIGATOR_DEFAULT_WIDTH)
  const [editingBase, setEditingBase] = useState<EditableKnowledgeBase | null>(null)
  const [editingGroup, setEditingGroup] = useState<EditableKnowledgeGroup | null>(null)
  const [isAddSourceDialogOpen, setIsAddSourceDialogOpen] = useState(false)
  const [isCreateBaseDialogOpen, setIsCreateBaseDialogOpen] = useState(false)
  const [createBaseInitialGroupId, setCreateBaseInitialGroupId] = useState<string | undefined>()
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false)
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

  const selectBase = useCallback((baseId: string) => {
    setPendingSelectedBaseId(null)
    setSelectedBaseId(baseId)
  }, [])

  const openCreateBaseDialog = useCallback((groupId?: string) => {
    setCreateBaseInitialGroupId(groupId)
    setIsCreateBaseDialogOpen(true)
  }, [])

  const openAddSourceDialog = useCallback(() => {
    setIsAddSourceDialogOpen(true)
  }, [])

  const openCreateGroupDialog = useCallback(() => {
    setIsCreateGroupDialogOpen(true)
  }, [])

  const openRenameBaseDialog = useCallback((base: EditableKnowledgeBase) => {
    setEditingBase(base)
  }, [])

  const openRenameGroupDialog = useCallback((group: EditableKnowledgeGroup) => {
    setEditingGroup(group)
  }, [])

  const handleCreateBaseDialogOpenChange = useCallback((open: boolean) => {
    setIsCreateBaseDialogOpen(open)

    if (!open) {
      setCreateBaseInitialGroupId(undefined)
    }
  }, [])

  const handleAddSourceDialogOpenChange = useCallback((open: boolean) => {
    setIsAddSourceDialogOpen(open)
  }, [])

  const handleCreateGroupDialogOpenChange = useCallback((open: boolean) => {
    setIsCreateGroupDialogOpen(open)
  }, [])

  const handleRenameBaseDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingBase(null)
    }
  }, [])

  const handleRenameGroupDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingGroup(null)
    }
  }, [])

  const handleCreateBaseCreated = useCallback((createdBase: { id: string }) => {
    setPendingSelectedBaseId(createdBase.id)
    setSelectedBaseId(createdBase.id)
  }, [])

  const submitCreateGroup = useCallback(
    async (name: string) => {
      await createGroup(name)
      setIsCreateGroupDialogOpen(false)
    },
    [createGroup]
  )

  const submitRenameBase = useCallback(
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

  const submitRenameGroup = useCallback(
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

  const moveBase = useCallback(
    async (baseId: string, groupId: string) => {
      await updateBase(baseId, { groupId })
    },
    [updateBase]
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

  const value = useMemo<KnowledgePageContextValue>(
    () => ({
      bases,
      groups,
      isLoading,
      selectedBase,
      selectedBaseId,
      selectedBaseItems,
      isItemsLoading,
      activeTab,
      navigatorWidth,
      contentRef,
      editingBase,
      editingGroup,
      isAddSourceDialogOpen,
      isCreateBaseDialogOpen,
      isCreateGroupDialogOpen,
      createBaseInitialGroupId,
      isCreatingBase,
      isCreatingGroup,
      isUpdatingBase,
      isUpdatingGroup,
      createBase,
      selectBase,
      setActiveTab,
      openAddSourceDialog,
      openCreateBaseDialog,
      openCreateGroupDialog,
      openRenameBaseDialog,
      openRenameGroupDialog,
      handleAddSourceDialogOpenChange,
      handleCreateBaseDialogOpenChange,
      handleCreateGroupDialogOpenChange,
      handleRenameBaseDialogOpenChange,
      handleRenameGroupDialogOpenChange,
      handleCreateBaseCreated,
      submitCreateGroup,
      submitRenameBase,
      submitRenameGroup,
      moveBase,
      deleteBase: handleDeleteBase,
      deleteGroup: handleDeleteGroup,
      startNavigatorResize
    }),
    [
      activeTab,
      bases,
      createBase,
      editingBase,
      editingGroup,
      groups,
      handleAddSourceDialogOpenChange,
      handleCreateBaseCreated,
      handleCreateBaseDialogOpenChange,
      handleCreateGroupDialogOpenChange,
      handleDeleteBase,
      handleDeleteGroup,
      handleRenameBaseDialogOpenChange,
      handleRenameGroupDialogOpenChange,
      isAddSourceDialogOpen,
      isCreateBaseDialogOpen,
      isCreateGroupDialogOpen,
      createBaseInitialGroupId,
      isCreatingBase,
      isCreatingGroup,
      isItemsLoading,
      isLoading,
      isUpdatingBase,
      isUpdatingGroup,
      moveBase,
      navigatorWidth,
      openAddSourceDialog,
      openCreateBaseDialog,
      openCreateGroupDialog,
      openRenameBaseDialog,
      openRenameGroupDialog,
      selectBase,
      selectedBase,
      selectedBaseId,
      selectedBaseItems,
      startNavigatorResize,
      submitCreateGroup,
      submitRenameBase,
      submitRenameGroup
    ]
  )

  return <KnowledgePageContext value={value}>{children}</KnowledgePageContext>
}

export const useKnowledgePage = () => {
  const context = use(KnowledgePageContext)

  if (!context) {
    throw new Error('useKnowledgePage must be used within KnowledgePageProvider')
  }

  return context
}
