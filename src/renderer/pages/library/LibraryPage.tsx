import { Alert, Button } from '@cherrystudio/ui'
import PromptEditDialog from '@renderer/components/PromptEditDialog'
import { useAgentModelFilter } from '@renderer/hooks/agents/useAgentModelFilter'
import { useEnsureTags, useTagList } from '@renderer/hooks/useTags'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Prompt } from '@shared/data/types/prompt'
import type { Tag } from '@shared/data/types/tag'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentMutations } from './adapters/agentAdapter'
import { useAssistantMutations } from './adapters/assistantAdapter'
import { usePromptMutations, usePromptMutationsById } from './adapters/promptAdapter'
import { DEFAULT_TAG_COLOR, getRandomTagColor, RESOURCE_TYPE_ORDER } from './constants'
import SkillDetailDialog from './detail/skill/SkillDetailDialog'
import {
  AgentEditDialog,
  AssistantEditDialog,
  ResourceCreateDialog,
  type ResourceCreateDialogKind,
  type ResourceCreateDialogValues
} from './dialogs'
import { isSelectableAssistantModel } from './dialogs/form/assistantModelFilter'
import { AssistantPresetPreviewDialog } from './list/AssistantPresetPreviewDialog'
import { DeleteConfirmDialog } from './list/DeleteConfirmDialog'
import { ImportAssistantDialog } from './list/ImportAssistantDialog'
import { ImportSkillDialog } from './list/ImportSkillDialog'
import { LibrarySidebar } from './list/LibrarySidebar'
import { ResourceGrid } from './list/ResourceGrid'
import {
  ASSISTANT_CATALOG_MY_TAB,
  type AssistantCatalogPreset,
  toCreateAssistantDtoFromCatalogPreset,
  useAssistantPresetCatalog
} from './list/useAssistantPresetCatalog'
import { useResourceLibrary } from './list/useResourceLibrary'
import type { AgentDetail, LibrarySidebarFilter, ResourceItem, ResourceType, TagItem } from './types'
import { serializeAssistantForExport } from './utils/assistantTransfer'

type EditDialogState = { kind: 'assistant'; resource: Assistant } | { kind: 'agent'; resource: AgentDetail }

type PromptDialogState = { prompt: Prompt | null } | null

const DEFAULT_RESOURCE_TYPE = RESOURCE_TYPE_ORDER[0]

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
    }
    r.tags.forEach((t) => tagMap.set(t, (tagMap.get(t) || 0) + 1))
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

export default function LibraryPage() {
  const { t } = useTranslation()
  const [sidebarFilter, setSidebarFilter] = useState<LibrarySidebarFilter>(() => ({
    resourceType: DEFAULT_RESOURCE_TYPE
  }))
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<ResourceItem | null>(null)
  const [createDialogKind, setCreateDialogKind] = useState<ResourceCreateDialogKind | null>(null)
  const [editDialog, setEditDialog] = useState<EditDialogState | null>(null)
  const [creatingResource, setCreatingResource] = useState(false)
  const [promptDialog, setPromptDialog] = useState<PromptDialogState>(null)
  const [selectedSkill, setSelectedSkill] = useState<InstalledSkill | null>(null)
  const [assistantImportOpen, setAssistantImportOpen] = useState(false)
  const [skillImportOpen, setSkillImportOpen] = useState(false)
  const [activeAssistantCatalogTab, setActiveAssistantCatalogTab] = useState(ASSISTANT_CATALOG_MY_TAB)
  const [previewAssistantPreset, setPreviewAssistantPreset] = useState<AssistantCatalogPreset | null>(null)
  const [previewAssistantPresetAdding, setPreviewAssistantPresetAdding] = useState(false)

  const activeResourceType = sidebarFilter.resourceType
  const isAssistantLibrary = activeResourceType === 'assistant'
  const isAssistantCatalogMine = !isAssistantLibrary || activeAssistantCatalogTab === ASSISTANT_CATALOG_MY_TAB

  const {
    resources,
    allResources,
    typeCounts,
    isLoading,
    error: resourceError,
    refetch
  } = useResourceLibrary({
    sidebarFilter,
    activeTag: isAssistantLibrary && isAssistantCatalogMine ? activeTag : null,
    search: !isAssistantLibrary || isAssistantCatalogMine ? search : '',
    sort: 'name'
  })

  const assistantCatalog = useAssistantPresetCatalog({
    activeTab: activeAssistantCatalogTab,
    search,
    mineCount: typeCounts.assistant,
    enabled: isAssistantLibrary
  })

  const assistantTagUiEnabled = isAssistantLibrary && isAssistantCatalogMine

  const { createAssistant, duplicateAssistant } = useAssistantMutations()
  const { createAgent } = useAgentMutations()
  const agentModelFilter = useAgentModelFilter('claude-code')
  const { createPrompt } = usePromptMutations()
  const promptDialogPrompt = promptDialog?.prompt ?? null
  const { updatePrompt } = usePromptMutationsById(promptDialogPrompt?.id ?? '')
  // The add-tag control uses ensureTags idempotently: existing names are reused,
  // and missing names are created before the card menu / dialog binds them.
  const { ensureTags } = useEnsureTags({ getDefaultColor: getRandomTagColor })
  // Single source of truth for "what tags exist anywhere" — backs the selection
  // pools (card menu / BasicSection) and feeds chip colors. Revalidated by the
  // `refresh: ['/tags']` side-effect on createTag / ensureTags.
  const tagList = useTagList()

  const scopedTags = useMemo(() => {
    if (!assistantTagUiEnabled) return []
    return buildTags(allResources, tagList.tags, 'assistant')
  }, [allResources, assistantTagUiEnabled, tagList.tags])

  // Selection pool includes *every* tag that exists server-side — even ones
  // that have never been bound to an assistant, so a newly-created tag from
  // The add-tag button is immediately pickable in the card menu.
  const allTagNames = useMemo(
    () => tagList.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b, 'zh')),
    [tagList.tags]
  )

  const noop = useCallback(() => {}, [])
  const handleClosePromptDialog = useCallback(() => {
    setPromptDialog(null)
  }, [])

  const handlePromptDialogSave = useCallback(
    async (data: { title: string; content: string }) => {
      const prompt = promptDialogPrompt

      try {
        if (prompt) {
          await updatePrompt(data)
        } else {
          await createPrompt(data)
        }

        refetch()
        setPromptDialog(null)
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(
            error,
            t(prompt ? 'settings.prompts.errors.updateFailed' : 'settings.prompts.errors.createFailed')
          )
        )
        throw error
      }
    },
    [createPrompt, promptDialogPrompt, refetch, t, updatePrompt]
  )

  useEffect(() => {
    if (!isAssistantLibrary) return
    if (assistantCatalog.tabs.some((tab) => tab.id === activeAssistantCatalogTab)) return

    setActiveTag(null)
    setActiveAssistantCatalogTab(ASSISTANT_CATALOG_MY_TAB)
  }, [activeAssistantCatalogTab, assistantCatalog.tabs, isAssistantLibrary])

  const handleOpenResource = useCallback((r: ResourceItem) => {
    if (r.type === 'assistant') {
      setEditDialog({ kind: 'assistant', resource: r.raw })
    } else if (r.type === 'agent') {
      setEditDialog({ kind: 'agent', resource: r.raw })
    } else if (r.type === 'skill') {
      setSelectedSkill(r.raw)
    } else if (r.type === 'prompt') {
      setPromptDialog({ prompt: r.raw })
    }
  }, [])

  const handleDuplicate = useCallback(
    async (r: ResourceItem) => {
      if (r.type === 'assistant') {
        try {
          await duplicateAssistant(r.raw)
          refetch()
        } catch (error) {
          window.toast.error(error instanceof Error ? error.message : t('library.duplicate_assistant_failed'))
        }
      }
    },
    [duplicateAssistant, refetch, t]
  )

  const addAssistantPreset = useCallback(
    async (preset: AssistantCatalogPreset) => {
      await createAssistant(toCreateAssistantDtoFromCatalogPreset(preset))
      refetch()
      window.toast.success(t('common.add_success'))
    },
    [createAssistant, refetch, t]
  )

  const handleAddAssistantPreset = useCallback(
    async (preset: AssistantCatalogPreset) => {
      try {
        await addAssistantPreset(preset)
      } catch (error) {
        window.toast.error(error instanceof Error ? error.message : t('library.assistant_catalog.add_failed'))
      }
    },
    [addAssistantPreset, t]
  )

  const handlePreviewAssistantPreset = useCallback((preset: AssistantCatalogPreset) => {
    setPreviewAssistantPreset(preset)
  }, [])

  const handleAddPreviewAssistantPreset = useCallback(async () => {
    if (!previewAssistantPreset || previewAssistantPresetAdding) return

    setPreviewAssistantPresetAdding(true)
    try {
      await addAssistantPreset(previewAssistantPreset)
      setPreviewAssistantPreset(null)
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : t('library.assistant_catalog.add_failed'))
    } finally {
      setPreviewAssistantPresetAdding(false)
    }
  }, [addAssistantPreset, previewAssistantPreset, previewAssistantPresetAdding, t])

  const handlePreviewOpenChange = useCallback(
    (open: boolean) => {
      if (open || previewAssistantPresetAdding) return
      setPreviewAssistantPreset(null)
    },
    [previewAssistantPresetAdding]
  )

  const handleDelete = useCallback((r: ResourceItem) => setDeleteConfirm(r), [])

  const handleExport = useCallback(
    async (r: ResourceItem) => {
      if (r.type !== 'assistant') return

      const assistant = r.raw
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
    } else if (type === 'agent') {
      setCreateDialogKind('agent')
    } else if (type === 'skill') {
      // Skill install lives in a dialog (mirrors ImportAssistantDialog) so the
      // ZIP / directory / marketplace flows from Settings → Skills can be exposed
      // here without leaving the library page.
      setSkillImportOpen(true)
    } else if (type === 'prompt') {
      setPromptDialog({ prompt: null })
    }
  }, [])

  const handleCreateDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open || creatingResource) return
      setCreateDialogKind(null)
    },
    [creatingResource]
  )

  const handleSubmitCreateResource = useCallback(
    async (values: ResourceCreateDialogValues) => {
      const kind = createDialogKind
      if (!kind || creatingResource) return

      setCreatingResource(true)
      try {
        if (kind === 'assistant') {
          await createAssistant({
            name: values.name,
            emoji: values.avatar,
            modelId: values.modelId,
            description: values.description
          })
        } else {
          await createAgent({
            type: 'claude-code',
            name: values.name,
            model: values.modelId,
            planModel: values.modelId,
            smallModel: values.modelId,
            description: values.description,
            configuration: {
              avatar: values.avatar,
              permission_mode: 'bypassPermissions',
              soul_enabled: true
            }
          })
        }

        setCreateDialogKind(null)
        refetch()
      } finally {
        setCreatingResource(false)
      }
    },
    [createAgent, createAssistant, createDialogKind, creatingResource, refetch]
  )

  const handleEditDialogOpenChange = useCallback((open: boolean) => {
    if (open) return
    setEditDialog(null)
  }, [])

  const handleEditSaved = useCallback(() => {
    refetch()
  }, [refetch])

  const handleAssistantTabChange = useCallback((tabId: string) => {
    setActiveAssistantCatalogTab(tabId)
    setActiveTag(null)
  }, [])

  const assistantCatalogProp = useMemo(
    () =>
      isAssistantLibrary
        ? {
            activeTab: activeAssistantCatalogTab,
            tabs: assistantCatalog.tabs,
            presets: assistantCatalog.presets,
            onTabChange: handleAssistantTabChange,
            onAddPreset: handleAddAssistantPreset,
            onPreviewPreset: handlePreviewAssistantPreset
          }
        : undefined,
    [
      activeAssistantCatalogTab,
      assistantCatalog.presets,
      assistantCatalog.tabs,
      handleAddAssistantPreset,
      handleAssistantTabChange,
      handlePreviewAssistantPreset,
      isAssistantLibrary
    ]
  )

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <LibrarySidebar
        filter={sidebarFilter}
        onFilterChange={(f) => {
          setSidebarFilter(f)
          setActiveTag(null)
          if (f.resourceType !== 'assistant') {
            setActiveAssistantCatalogTab(ASSISTANT_CATALOG_MY_TAB)
          }
        }}
        typeCounts={typeCounts}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {resourceError ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <Alert
              type="error"
              showIcon
              message={t('common.error')}
              description={resourceError.message}
              action={
                <Button variant="outline" size="sm" onClick={refetch}>
                  {t('common.retry')}
                </Button>
              }
              className="max-w-lg rounded-md px-4 py-3 shadow-none"
            />
          </div>
        ) : (
          <ResourceGrid
            resources={resources}
            isLoading={isLoading}
            activeResourceType={activeResourceType}
            search={search}
            onSearchChange={setSearch}
            onEdit={handleOpenResource}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            onExport={(resource) => {
              void handleExport(resource)
            }}
            onCreate={handleCreate}
            onImportAssistant={() => setAssistantImportOpen(true)}
            tags={scopedTags}
            activeTag={activeTag}
            onTagFilter={setActiveTag}
            onAddTag={async (tagName) => {
              // Idempotent: ensureTags reuses existing names or creates missing
              // rows; binding stays inside card/dialog tag hooks.
              await ensureTags([tagName])
            }}
            onUpdateResourceTags={noop /* binding is executed inside FixedCardMenu via the tag hooks */}
            allTagNames={allTagNames}
            allTags={tagList.tags}
            assistantCatalog={assistantCatalogProp}
          />
        )}
      </div>

      <DeleteConfirmDialog resource={deleteConfirm} onClose={() => setDeleteConfirm(null)} />
      <SkillDetailDialog
        skill={selectedSkill}
        open={Boolean(selectedSkill)}
        onOpenChange={(open) => {
          if (!open) setSelectedSkill(null)
        }}
      />
      <AssistantPresetPreviewDialog
        preset={previewAssistantPreset}
        open={Boolean(previewAssistantPreset)}
        adding={previewAssistantPresetAdding}
        onOpenChange={handlePreviewOpenChange}
        onAdd={handleAddPreviewAssistantPreset}
      />
      <ImportAssistantDialog open={assistantImportOpen} onOpenChange={setAssistantImportOpen} onImported={refetch} />
      <ImportSkillDialog open={skillImportOpen} onOpenChange={setSkillImportOpen} onInstalled={refetch} />
      <ResourceCreateDialog
        kind={createDialogKind ?? 'assistant'}
        open={createDialogKind !== null}
        isSubmitting={creatingResource}
        modelFilter={createDialogKind === 'agent' ? agentModelFilter : isSelectableAssistantModel}
        onOpenChange={handleCreateDialogOpenChange}
        onSubmit={handleSubmitCreateResource}
      />
      {editDialog?.kind === 'assistant' ? (
        <AssistantEditDialog
          open
          resource={editDialog.resource}
          modelFilter={isSelectableAssistantModel}
          onOpenChange={handleEditDialogOpenChange}
          onSaved={handleEditSaved}
        />
      ) : null}
      {editDialog?.kind === 'agent' ? (
        <AgentEditDialog
          open
          resource={editDialog.resource}
          modelFilter={agentModelFilter}
          onOpenChange={handleEditDialogOpenChange}
          onSaved={handleEditSaved}
        />
      ) : null}
      <PromptEditDialog
        open={promptDialog !== null}
        prompt={promptDialogPrompt}
        onSave={handlePromptDialogSave}
        onCancel={handleClosePromptDialog}
      />
    </div>
  )
}
