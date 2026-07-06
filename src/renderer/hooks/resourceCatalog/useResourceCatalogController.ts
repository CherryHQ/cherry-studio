import { useEnsureTags, useTagList } from '@renderer/hooks/useTags'
import type { AgentDetail, ResourceItem, ResourceType, TagItem } from '@renderer/types/resourceCatalog'
import { serializeAssistantForExport } from '@renderer/utils/assistantTransfer'
import { DEFAULT_TAG_COLOR, getRandomTagColor } from '@renderer/utils/resourceTags'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { UniqueModelId } from '@shared/data/types/model'
import type { Tag } from '@shared/data/types/tag'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentMutations } from './agentAdapter'
import { useAssistantMutations } from './assistantAdapter'
import { useResourceLibrary } from './useResourceLibrary'

type EditDialogState = { kind: 'assistant'; resource: Assistant } | { kind: 'agent'; resource: AgentDetail }

type ResourceCreateWizardKind = 'assistant' | 'agent'
type ResourceCatalogControllerType = Extract<ResourceType, 'assistant' | 'agent' | 'skill'>

type ResourceCreateWizardValues = {
  avatar: string
  name: string
  modelId: UniqueModelId
  description: string
  prompt: string
  knowledgeBaseIds: string[]
  skillIds: string[]
}

const DIALOG_EXIT_ANIMATION_MS = 200

/**
 * Build the top-bar chip list.
 *
 * Source: `resources` (so count reflects real bindings — unbound tags stay hidden,
 * matching the default collapsed state). Tag id/color are resolved from the
 * backend `/tags` list and embedded assistant tag refs; only if neither has the
 * tag yet (SWR cache race) do we fall back to `DEFAULT_TAG_COLOR`.
 */
function buildTags(resources: ResourceItem[], backendTags: Tag[], filterType?: ResourceType): TagItem[] {
  const backendTagByName = new Map(backendTags.map((t) => [t.name, t] as const))
  const tagMap = new Map<string, number>()
  const list = filterType ? resources.filter((r) => r.type === filterType) : resources
  list.forEach((r) => {
    if (r.type === 'assistant') {
      for (const tag of r.raw.tags ?? []) {
        if (!backendTagByName.has(tag.name)) backendTagByName.set(tag.name, tag)
      }
      if (r.tag) {
        tagMap.set(r.tag, (tagMap.get(r.tag) || 0) + 1)
      }
    }
  })
  return Array.from(tagMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count], index) => ({
      id: backendTagByName.get(name)?.id ?? `tag-${index}`,
      name,
      color: backendTagByName.get(name)?.color ?? DEFAULT_TAG_COLOR,
      count
    }))
}

export function useResourceCatalogController(resourceType: ResourceCatalogControllerType) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
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

  const isAssistantLibrary = resourceType === 'assistant'

  const {
    resources,
    allResources,
    isLoading,
    error: resourceError,
    refetch
  } = useResourceLibrary({
    resourceType,
    activeTag: isAssistantLibrary ? activeTag : null,
    search,
    sort: 'name'
  })

  useEffect(() => {
    setActiveTag(null)
  }, [resourceType])

  const { createAssistant, duplicateAssistant } = useAssistantMutations()
  const { createAgent } = useAgentMutations()
  const { ensureTags } = useEnsureTags({ getDefaultColor: getRandomTagColor })
  const tagList = useTagList()

  const scopedTags = useMemo(() => {
    if (!isAssistantLibrary) return []
    return buildTags(allResources, tagList.tags, 'assistant')
  }, [allResources, isAssistantLibrary, tagList.tags])

  const allTagNames = useMemo(
    () => tagList.tags.map((tag) => tag.name).sort((a, b) => a.localeCompare(b, 'zh')),
    [tagList.tags]
  )

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
          window.toast.error(error instanceof Error ? error.message : t('library.duplicate_assistant_failed'))
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
        const content = serializeAssistantForExport(assistant)

        await window.api.file.save(`${assistant.name}.json`, new TextEncoder().encode(content), {
          filters: [{ name: t('assistants.presets.import.file_filter'), extensions: ['json'] }]
        })
      } catch (error) {
        window.toast.error(error instanceof Error ? error.message : t('library.export_assistant_failed'))
      }
    },
    [t]
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
    async (values: ResourceCreateWizardValues) => {
      const kind = createDialogKind
      if (!kind || creatingResource) return

      setCreatingResource(true)
      try {
        if (kind === 'assistant') {
          await createAssistant({
            name: values.name,
            emoji: values.avatar,
            modelId: values.modelId,
            description: values.description,
            prompt: values.prompt,
            knowledgeBaseIds: values.knowledgeBaseIds
          })
        } else {
          await createAgent({
            type: 'claude-code',
            name: values.name,
            model: values.modelId,
            planModel: values.modelId,
            smallModel: values.modelId,
            description: values.description,
            instructions: values.prompt,
            skillIds: values.skillIds,
            configuration: {
              avatar: values.avatar,
              permission_mode: 'bypassPermissions',
              soul_enabled: true
            }
          })
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
      tags: scopedTags,
      activeTag,
      onTagFilter: setActiveTag,
      onAddTag: async (tagName: string) => {
        await ensureTags([tagName])
      },
      allTagNames,
      allTags: tagList.tags
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
      setAssistantImportOpen,
      setAssistantLibraryOpen,
      setDeleteConfirm,
      setSelectedSkill,
      setSkillImportOpen,
      handleCreateDialogOpenChange,
      handleEditDialogOpenChange,
      handleEditSaved,
      handleSubmitCreateResource
    }
  }
}
