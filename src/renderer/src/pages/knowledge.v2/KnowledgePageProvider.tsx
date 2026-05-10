import {
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useKnowledgeBases,
  useRestoreKnowledgeBase,
  useUpdateKnowledgeBase
} from '@renderer/hooks/useKnowledgeBases'
import { useKnowledgeItems } from '@renderer/hooks/useKnowledgeItems'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
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
import { useTranslation } from 'react-i18next'

import { useCreateKnowledgeGroup, useDeleteKnowledgeGroup, useKnowledgeGroups, useUpdateKnowledgeGroup } from './hooks'
import type { KnowledgeRestoreBaseInitialValues } from './panels/ragConfig/RagConfigPanel'
import type { KnowledgeTabKey } from './types'

const NAVIGATOR_DEFAULT_WIDTH = 180
const NAVIGATOR_MIN_WIDTH = 180
const NAVIGATOR_MAX_WIDTH = 360

type EditableKnowledgeGroup = Pick<Group, 'id' | 'name'>
type EditableKnowledgeBase = Pick<KnowledgeBase, 'id' | 'name'>
type KnowledgeBaseItems = ReturnType<typeof useKnowledgeItems>['items']
type CreateKnowledgeBase = ReturnType<typeof useCreateKnowledgeBase>['createBase']
type RestoreKnowledgeBase = ReturnType<typeof useRestoreKnowledgeBase>['restoreBase']

interface KnowledgePageContextValue {
  bases: KnowledgeBase[]
  groups: Group[]
  isLoading: boolean
  selectedBase: KnowledgeBase | undefined
  selectedBaseId: string
  selectedBaseItems: KnowledgeBaseItems
  selectedItemId: string | null
  isItemsLoading: boolean
  activeTab: KnowledgeTabKey
  navigatorWidth: number
  contentRef: RefObject<HTMLDivElement | null>
  editingBase: EditableKnowledgeBase | null
  editingGroup: EditableKnowledgeGroup | null
  restoringBase: KnowledgeBase | null
  restoreBaseInitialValues: KnowledgeRestoreBaseInitialValues | undefined
  isAddSourceDialogOpen: boolean
  isCreateBaseDialogOpen: boolean
  isCreateGroupDialogOpen: boolean
  createBaseInitialGroupId: string | undefined
  isCreatingBase: boolean
  isCreatingGroup: boolean
  isUpdatingBase: boolean
  isUpdatingGroup: boolean
  isRestoringBase: boolean
  createBase: CreateKnowledgeBase
  restoreBase: RestoreKnowledgeBase
  selectBase: (baseId: string) => void
  setActiveTab: (tab: KnowledgeTabKey) => void
  openItemChunks: (itemId: string) => void
  closeItemChunks: () => void
  openAddSourceDialog: () => void
  openCreateBaseDialog: (groupId?: string) => void
  openCreateGroupDialog: () => void
  openRenameBaseDialog: (base: EditableKnowledgeBase) => void
  openRenameGroupDialog: (group: EditableKnowledgeGroup) => void
  openRestoreBaseDialog: (base: KnowledgeBase, initialValues?: KnowledgeRestoreBaseInitialValues) => void
  handleAddSourceDialogOpenChange: (open: boolean) => void
  handleCreateBaseDialogOpenChange: (open: boolean) => void
  handleCreateGroupDialogOpenChange: (open: boolean) => void
  handleRenameBaseDialogOpenChange: (open: boolean) => void
  handleRenameGroupDialogOpenChange: (open: boolean) => void
  handleRestoreBaseDialogOpenChange: (open: boolean) => void
  handleCreateBaseCreated: (createdBase: { id: string }) => void
  handleRestoreBaseRestored: (restoredBase: { id: string }) => void
  submitCreateGroup: (name: string) => Promise<void>
  submitRenameBase: (name: string) => Promise<void>
  submitRenameGroup: (name: string) => Promise<void>
  moveBase: (baseId: string, groupId: string | null) => Promise<void>
  deleteBase: (baseId: string) => Promise<void>
  deleteGroup: (groupId: string) => Promise<void>
  startNavigatorResize: (event: ReactMouseEvent<HTMLDivElement>) => void
}

const KnowledgePageContext = createContext<KnowledgePageContextValue | null>(null)

export const KnowledgePageProvider = ({ children }: PropsWithChildren) => {
  const { t } = useTranslation()
  const { bases, isLoading } = useKnowledgeBases()
  const { groups } = useKnowledgeGroups()
  const { createGroup, isCreating: isCreatingGroup } = useCreateKnowledgeGroup()
  const { createBase, isCreating: isCreatingBase } = useCreateKnowledgeBase()
  const { restoreBase, isRestoring: isRestoringBase } = useRestoreKnowledgeBase()
  const { updateBase, isUpdating: isUpdatingBase } = useUpdateKnowledgeBase()
  const { updateGroup, isUpdating: isUpdatingGroup } = useUpdateKnowledgeGroup()
  const { deleteBase } = useDeleteKnowledgeBase()
  const { deleteGroup } = useDeleteKnowledgeGroup()
  const [selectedBaseId, setSelectedBaseId] = useState('')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [pendingSelectedBaseId, setPendingSelectedBaseId] = useState<string | null>(null)
  const { items: selectedBaseItems, isLoading: isItemsLoading } = useKnowledgeItems(selectedBaseId)
  const [activeTab, setActiveTab] = useState<KnowledgeTabKey>('data')
  const [navigatorWidth, setNavigatorWidth] = useState(NAVIGATOR_DEFAULT_WIDTH)
  const [editingBase, setEditingBase] = useState<EditableKnowledgeBase | null>(null)
  const [editingGroup, setEditingGroup] = useState<EditableKnowledgeGroup | null>(null)
  const [restoringBase, setRestoringBase] = useState<KnowledgeBase | null>(null)
  const [restoreBaseInitialValues, setRestoreBaseInitialValues] = useState<
    KnowledgeRestoreBaseInitialValues | undefined
  >()
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
      setSelectedItemId(null)
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
      setSelectedItemId(null)
    }
  }, [bases, pendingSelectedBaseId, selectedBaseId])

  const selectBase = useCallback((baseId: string) => {
    setPendingSelectedBaseId(null)
    setSelectedBaseId(baseId)
    setSelectedItemId(null)
  }, [])

  const handleSetActiveTab = useCallback((tab: KnowledgeTabKey) => {
    setActiveTab(tab)
    setSelectedItemId(null)
  }, [])

  const openItemChunks = useCallback((itemId: string) => {
    setSelectedItemId(itemId)
  }, [])

  const closeItemChunks = useCallback(() => {
    setSelectedItemId(null)
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

  const openRestoreBaseDialog = useCallback(
    (base: KnowledgeBase, initialValues?: KnowledgeRestoreBaseInitialValues) => {
      setRestoringBase(base)
      setRestoreBaseInitialValues(initialValues)
    },
    []
  )

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

  const handleRestoreBaseDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setRestoringBase(null)
      setRestoreBaseInitialValues(undefined)
    }
  }, [])

  const handleCreateBaseCreated = useCallback((createdBase: { id: string }) => {
    setPendingSelectedBaseId(createdBase.id)
    setSelectedBaseId(createdBase.id)
    setSelectedItemId(null)
  }, [])

  const handleRestoreBaseRestored = useCallback((restoredBase: { id: string }) => {
    setRestoringBase(null)
    setRestoreBaseInitialValues(undefined)
    setPendingSelectedBaseId(restoredBase.id)
    setSelectedBaseId(restoredBase.id)
    setSelectedItemId(null)
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
    async (baseId: string, groupId: string | null) => {
      try {
        await updateBase(baseId, { groupId })
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge_v2.error.failed_to_move')))
      }
    },
    [t, updateBase]
  )

  const handleDeleteBase = useCallback(
    async (baseId: string) => {
      try {
        await deleteBase(baseId)
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge_v2.error.failed_to_delete')))
      }
    },
    [deleteBase, t]
  )

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      try {
        await deleteGroup(groupId)
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('knowledge_v2.groups.error.failed_to_delete')))
      }
    },
    [deleteGroup, t]
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
      selectedItemId,
      isItemsLoading,
      activeTab,
      navigatorWidth,
      contentRef,
      editingBase,
      editingGroup,
      restoringBase,
      restoreBaseInitialValues,
      isAddSourceDialogOpen,
      isCreateBaseDialogOpen,
      isCreateGroupDialogOpen,
      createBaseInitialGroupId,
      isCreatingBase,
      isCreatingGroup,
      isUpdatingBase,
      isUpdatingGroup,
      isRestoringBase,
      createBase,
      restoreBase,
      selectBase,
      setActiveTab: handleSetActiveTab,
      openItemChunks,
      closeItemChunks,
      openAddSourceDialog,
      openCreateBaseDialog,
      openCreateGroupDialog,
      openRenameBaseDialog,
      openRenameGroupDialog,
      openRestoreBaseDialog,
      handleAddSourceDialogOpenChange,
      handleCreateBaseDialogOpenChange,
      handleCreateGroupDialogOpenChange,
      handleRenameBaseDialogOpenChange,
      handleRenameGroupDialogOpenChange,
      handleRestoreBaseDialogOpenChange,
      handleCreateBaseCreated,
      handleRestoreBaseRestored,
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
      restoringBase,
      restoreBaseInitialValues,
      groups,
      handleAddSourceDialogOpenChange,
      handleCreateBaseCreated,
      handleCreateBaseDialogOpenChange,
      handleCreateGroupDialogOpenChange,
      handleDeleteBase,
      handleDeleteGroup,
      handleSetActiveTab,
      handleRenameBaseDialogOpenChange,
      handleRenameGroupDialogOpenChange,
      handleRestoreBaseDialogOpenChange,
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
      isRestoringBase,
      moveBase,
      navigatorWidth,
      openAddSourceDialog,
      closeItemChunks,
      openItemChunks,
      openCreateBaseDialog,
      openCreateGroupDialog,
      openRenameBaseDialog,
      openRenameGroupDialog,
      openRestoreBaseDialog,
      restoreBase,
      selectBase,
      selectedBase,
      selectedBaseId,
      selectedBaseItems,
      selectedItemId,
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
