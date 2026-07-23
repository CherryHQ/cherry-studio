import { useGroupMutations, useGroups } from '@renderer/hooks/useGroups'
import { toast } from '@renderer/services/toast'
import type {
  AgentDetail,
  GroupItem,
  ResourceCreateValues,
  ResourceItem,
  ResourceType
} from '@renderer/types/resourceCatalog'
import { serializeAssistantForExport } from '@renderer/utils/assistantTransfer'
import { buildCreateAgentDto, buildCreateAssistantDto } from '@renderer/utils/resourceCatalog'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Group } from '@shared/data/types/group'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentMutations } from './agentAdapter'
import { useAssistantMutations } from './assistantAdapter'
import { useResourceLibrary } from './useResourceLibrary'

type EditDialogState = { kind: 'assistant'; resource: Assistant } | { kind: 'agent'; resource: AgentDetail }

type ResourceCreateWizardKind = 'assistant' | 'agent'
type ResourceCatalogControllerType = Extract<ResourceType, 'assistant' | 'agent' | 'skill'>

const DIALOG_EXIT_ANIMATION_MS = 200

/**
 * Build the top-bar chip list.
 *
 * Source: canonical assistant groups plus the unfiltered assistant list. Groups
 * with no assistants stay hidden until the user expands the toolbar.
 */
function buildGroups(resources: ResourceItem[], groups: Group[], filterType?: ResourceType): GroupItem[] {
  const counts = new Map<string, number>()
  const list = filterType ? resources.filter((r) => r.type === filterType) : resources
  for (const resource of list) {
    if (resource.type === 'assistant' && resource.groupId) {
      counts.set(resource.groupId, (counts.get(resource.groupId) ?? 0) + 1)
    }
  }

  return groups.flatMap((group) => {
    const count = counts.get(group.id)
    return count ? [{ id: group.id, name: group.name, count }] : []
  })
}

export function useResourceCatalogController(resourceType: ResourceCatalogControllerType) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<ResourceItem | null>(null)
  const [createDialogKind, setCreateDialogKind] = useState<ResourceCreateWizardKind | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialog, setEditDialog] = useState<EditDialogState | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [creatingResource, setCreatingResource] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<InstalledSkill | null>(null)
  const [assistantImportOpen, setAssistantImportOpen] = useState(false)
  const [assistantLibraryOpen, setAssistantLibraryOpen] = useState(false)
  const [skillImportOpen, setSkillImportOpen] = useState(false)
  const [skillMarketplaceOpen, setSkillMarketplaceOpen] = useState(false)
  const [systemSkillOpen, setSystemSkillOpen] = useState(false)

  const isAssistantLibrary = resourceType === 'assistant'

  const {
    resources,
    allResources,
    isLoading,
    error: resourceError,
    refetch
  } = useResourceLibrary({
    resourceType,
    activeGroupId: isAssistantLibrary ? activeGroupId : null,
    search,
    sort: 'name'
  })

  useEffect(() => {
    setActiveGroupId(null)
  }, [resourceType])

  const { createAssistant, duplicateAssistant } = useAssistantMutations()
  const { createAgent } = useAgentMutations()
  const { groups } = useGroups('assistant')
  const { createGroup } = useGroupMutations('assistant')
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group] as const)), [groups])

  const scopedGroups = useMemo(() => {
    if (!isAssistantLibrary) return []
    return buildGroups(allResources, groups, 'assistant')
  }, [allResources, groups, isAssistantLibrary])

  useEffect(() => {
    if (createDialogOpen || !createDialogKind) return

    const timeoutId = window.setTimeout(() => setCreateDialogKind(null), DIALOG_EXIT_ANIMATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [createDialogKind, createDialogOpen])

  useEffect(() => {
    if (editDialogOpen || !editDialog) return

    const timeoutId = window.setTimeout(() => setEditDialog(null), DIALOG_EXIT_ANIMATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [editDialog, editDialogOpen])

  const handleOpenResource = useCallback((resource: ResourceItem) => {
    if (resource.type === 'assistant') {
      setEditDialog({ kind: 'assistant', resource: resource.raw })
      setEditDialogOpen(true)
    } else if (resource.type === 'agent') {
      setEditDialog({ kind: 'agent', resource: resource.raw })
      setEditDialogOpen(true)
    } else if (resource.type === 'skill') {
      setSelectedSkill(resource.raw)
    }
  }, [])

  const handleDuplicate = useCallback(
    async (resource: ResourceItem) => {
      if (resource.type === 'assistant') {
        try {
          await duplicateAssistant(resource.raw)
          refetch()
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t('library.duplicate_assistant_failed'))
        }
      }
    },
    [duplicateAssistant, refetch, t]
  )

  const handleExport = useCallback(
    async (resource: ResourceItem) => {
      if (resource.type !== 'assistant') return

      const assistant = resource.raw
      try {
        const groupName = assistant.groupId ? groupById.get(assistant.groupId)?.name : undefined
        const content = serializeAssistantForExport(assistant, groupName)

        await window.api.file.save(`${assistant.name}.json`, new TextEncoder().encode(content), {
          filters: [{ name: t('assistants.presets.import.file_filter'), extensions: ['json'] }]
        })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('library.export_assistant_failed'))
      }
    },
    [groupById, t]
  )

  const handleCreate = useCallback((type: ResourceType) => {
    if (type === 'assistant') {
      setCreateDialogKind('assistant')
      setCreateDialogOpen(true)
    } else if (type === 'agent') {
      setCreateDialogKind('agent')
      setCreateDialogOpen(true)
    } else if (type === 'skill') {
      setSkillImportOpen(true)
    }
  }, [])

  const handleCreateDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open && creatingResource) return
      setCreateDialogOpen(open)
    },
    [creatingResource]
  )

  const handleSubmitCreateResource = useCallback(
    async (values: ResourceCreateValues) => {
      const kind = createDialogKind
      if (!kind || creatingResource) return

      setCreatingResource(true)
      try {
        if (kind === 'assistant') {
          await createAssistant(buildCreateAssistantDto(values))
        } else {
          await createAgent(buildCreateAgentDto(values))
        }

        setCreateDialogOpen(false)
        refetch()
      } finally {
        setCreatingResource(false)
      }
    },
    [createAgent, createAssistant, createDialogKind, creatingResource, refetch]
  )

  const handleEditDialogOpenChange = useCallback((open: boolean) => {
    setEditDialogOpen(open)
  }, [])

  const handleEditSaved = useCallback(() => {
    refetch()
  }, [refetch])

  return {
    resourceError,
    refetch,
    gridProps: {
      resources,
      isLoading,
      activeResourceType: resourceType,
      search,
      onSearchChange: setSearch,
      onEdit: handleOpenResource,
      onDuplicate: handleDuplicate,
      onDelete: setDeleteConfirm,
      onExport: (resource: ResourceItem) => {
        void handleExport(resource)
      },
      onCreate: handleCreate,
      onImportAssistant: () => setAssistantImportOpen(true),
      onOpenAssistantLibrary: isAssistantLibrary ? () => setAssistantLibraryOpen(true) : undefined,
      onOpenSkillMarketplace: () => setSkillMarketplaceOpen(true),
      onOpenSystemSkills: () => setSystemSkillOpen(true),
      groups: scopedGroups,
      activeGroupId,
      onGroupFilter: setActiveGroupId,
      onAddGroup: async (groupName: string) => {
        await createGroup(groupName)
      },
      allGroups: groups
    },
    dialogs: {
      assistantImportOpen,
      assistantLibraryOpen,
      createDialogKind,
      createDialogOpen,
      creatingResource,
      deleteConfirm,
      editDialog,
      editDialogOpen,
      selectedSkill,
      skillImportOpen,
      skillMarketplaceOpen,
      systemSkillOpen,
      setAssistantImportOpen,
      setAssistantLibraryOpen,
      setDeleteConfirm,
      setSelectedSkill,
      setSkillImportOpen,
      setSkillMarketplaceOpen,
      setSystemSkillOpen,
      handleCreateDialogOpenChange,
      handleEditDialogOpenChange,
      handleEditSaved,
      handleSubmitCreateResource
    }
  }
}
