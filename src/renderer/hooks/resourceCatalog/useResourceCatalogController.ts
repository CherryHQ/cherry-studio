import { dataApiService } from '@data/DataApiService'
import { resolveTemplate } from '@renderer/data/utils/dataApiPath'
import { useGroupMutations, useGroups } from '@renderer/hooks/useGroups'
import { toast } from '@renderer/services/toast'
import type {
  GroupItem,
  ResourceCreateValues,
  ResourceEditDialogTarget,
  ResourceItem,
  ResourceType
} from '@renderer/types/resourceCatalog'
import { serializeAssistantForExport } from '@renderer/utils/assistantTransfer'
import { buildCreateAgentCommand, buildCreateAssistantDto } from '@renderer/utils/resourceCatalog'
import type { ConcreteApiPaths } from '@shared/data/api/paths'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { Group } from '@shared/data/types/group'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentMutations } from './agentAdapter'
import { useAssistantMutations } from './assistantAdapter'
import { useResourceLibrary } from './useResourceLibrary'

type ResourceCreateWizardKind = 'assistant' | 'agent'
type ResourceCatalogControllerType = Extract<ResourceType, 'assistant' | 'agent' | 'skill'>

const CREATE_DIALOG_EXIT_ANIMATION_MS = 200

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
  const [editDialogTarget, setEditDialogTarget] = useState<ResourceEditDialogTarget | null>(null)
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

    const timeoutId = window.setTimeout(() => setCreateDialogKind(null), CREATE_DIALOG_EXIT_ANIMATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [createDialogKind, createDialogOpen])

  const handleOpenResource = useCallback((resource: ResourceItem) => {
    if (resource.type === 'assistant') {
      setEditDialogTarget({ kind: 'assistant', id: resource.id })
    } else if (resource.type === 'agent') {
      setEditDialogTarget({ kind: 'agent', id: resource.id })
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
        const bindingPath = resolveTemplate('/prompt-bindings/:targetType/:targetId', {
          targetType: 'assistant',
          targetId: assistant.id
        }) as ConcreteApiPaths
        const contextualPrompts = await dataApiService.get(bindingPath)
        const content = serializeAssistantForExport(assistant, contextualPrompts, groupName)

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
          await createAgent(buildCreateAgentCommand(values))
        }

        setCreateDialogOpen(false)
        refetch()
      } finally {
        setCreatingResource(false)
      }
    },
    [createAgent, createAssistant, createDialogKind, creatingResource, refetch]
  )

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
      editDialogTarget,
      selectedSkill,
      skillImportOpen,
      skillMarketplaceOpen,
      systemSkillOpen,
      setAssistantImportOpen,
      setAssistantLibraryOpen,
      setDeleteConfirm,
      setEditDialogTarget,
      setSelectedSkill,
      setSkillImportOpen,
      setSkillMarketplaceOpen,
      setSystemSkillOpen,
      handleCreateDialogOpenChange,
      handleSubmitCreateResource
    }
  }
}
