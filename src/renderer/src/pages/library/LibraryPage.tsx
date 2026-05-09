import { Alert, Button } from '@cherrystudio/ui'
import type { AgentDetail, InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Prompt } from '@shared/data/types/prompt'
import type { Tag } from '@shared/data/types/tag'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistantMutations } from './adapters/assistantAdapter'
import { useEnsureTags, useTagList } from './adapters/tagAdapter'
import { DEFAULT_TAG_COLOR, RESOURCE_TYPE_ORDER } from './constants'
import SkillDetailPage from './detail/skill/SkillDetailPage'
import AgentConfigPage from './editor/agent/AgentConfigPage'
import AssistantConfigPage from './editor/assistant/AssistantConfigPage'
import { serializeAssistantForExport } from './editor/assistant/transfer'
import PromptConfigPage from './editor/prompt/PromptConfigPage'
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
import { buildLibraryListSearch, LIBRARY_ROUTE, parseLibraryRouteSearch } from './routeSearch'
import type { LibrarySidebarFilter, ResourceItem, ResourceType, TagItem } from './types'

type ConfigView =
  | { type: 'list' }
  | { type: 'assistant-create' }
  | { type: 'assistant-edit'; assistant: Assistant }
  | { type: 'agent-edit'; agent: AgentDetail }
  | { type: 'agent-create' }
  | { type: 'skill-detail'; skill: InstalledSkill }
  | { type: 'prompt-create' }
  | { type: 'prompt-edit'; prompt: Prompt }

const DEFAULT_RESOURCE_TYPE = RESOURCE_TYPE_ORDER[0]

/**
 * Build the top-bar chip list.
 *
 * Source: `resources` (so count reflects real bindings — unbound tags stay hidden,
 * matching the spec). Color is resolved against the backend `/tags` list; only
 * if the tag isn't in the list yet (SWR cache race) do we fall back to
 * `DEFAULT_TAG_COLOR`.
 */
function buildTags(resources: ResourceItem[], backendTags: Tag[], filterType?: ResourceType): TagItem[] {
  const colorByName = new Map(backendTags.map((t) => [t.name, t.color] as const))
  const tagMap = new Map<string, number>()
  const list = filterType ? resources.filter((r) => r.type === filterType) : resources
  list.forEach((r) => r.tags.forEach((t) => tagMap.set(t, (tagMap.get(t) || 0) + 1)))
  return Array.from(tagMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count], i) => ({
      id: `tag-${i}`,
      name,
      color: colorByName.get(name) ?? DEFAULT_TAG_COLOR,
      count
    }))
}

export default function LibraryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const routeSearch = parseLibraryRouteSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const routeResourceType = routeSearch.resourceType
  const routeAction = routeSearch.action
  const routeResourceId = routeSearch.id
  const [sidebarFilter, setSidebarFilter] = useState<LibrarySidebarFilter>(() => ({
    resourceType: routeResourceType ?? DEFAULT_RESOURCE_TYPE
  }))
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<ResourceItem | null>(null)
  const [configView, setConfigView] = useState<ConfigView>({ type: 'list' })
  const [assistantImportOpen, setAssistantImportOpen] = useState(false)
  const [skillImportOpen, setSkillImportOpen] = useState(false)
  const [activeAssistantCatalogTab, setActiveAssistantCatalogTab] = useState(ASSISTANT_CATALOG_MY_TAB)
  const [previewAssistantPreset, setPreviewAssistantPreset] = useState<AssistantCatalogPreset | null>(null)
  const [previewAssistantPresetAdding, setPreviewAssistantPresetAdding] = useState(false)

  const activeResourceType = sidebarFilter.resourceType
  const isAssistantLibrary = activeResourceType === 'assistant'

  const {
    resources,
    allResources,
    typeCounts,
    error: resourceError,
    refetch
  } = useResourceLibrary({
    sidebarFilter,
    activeTag: isAssistantLibrary && activeAssistantCatalogTab === ASSISTANT_CATALOG_MY_TAB ? activeTag : null,
    search: !isAssistantLibrary || activeAssistantCatalogTab === ASSISTANT_CATALOG_MY_TAB ? search : '',
    sort: 'name'
  })

  const assistantCatalog = useAssistantPresetCatalog({
    activeTab: activeAssistantCatalogTab,
    search,
    mineCount: typeCounts.assistant,
    enabled: isAssistantLibrary
  })

  const effectiveActiveAssistantCatalogTab = useMemo(() => {
    if (!isAssistantLibrary) return ASSISTANT_CATALOG_MY_TAB
    return assistantCatalog.tabs.some((tab) => tab.id === activeAssistantCatalogTab)
      ? activeAssistantCatalogTab
      : ASSISTANT_CATALOG_MY_TAB
  }, [activeAssistantCatalogTab, assistantCatalog.tabs, isAssistantLibrary])
  const isAssistantCatalogMine = !isAssistantLibrary || effectiveActiveAssistantCatalogTab === ASSISTANT_CATALOG_MY_TAB
  const assistantTagUiEnabled = isAssistantLibrary && isAssistantCatalogMine

  const { createAssistant, duplicateAssistant } = useAssistantMutations()
  // The add-tag control uses ensureTags idempotently: existing names are reused,
  // and missing names are created before the card menu / editor binds them.
  const { ensureTags } = useEnsureTags()
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
  const clearRouteActionSearch = useCallback(() => {
    if (!routeAction && !routeResourceType) return

    void navigate({
      to: LIBRARY_ROUTE,
      search: buildLibraryListSearch(routeResourceType ?? sidebarFilter.resourceType),
      replace: true
    })
  }, [navigate, routeAction, routeResourceType, sidebarFilter.resourceType])

  const handleBackToList = useCallback(() => {
    setConfigView({ type: 'list' })
    clearRouteActionSearch()
  }, [clearRouteActionSearch])
  const handleCreated = useCallback(() => {
    refetch()
    setConfigView({ type: 'list' })
    clearRouteActionSearch()
  }, [clearRouteActionSearch, refetch])

  useEffect(() => {
    if (!routeResourceType) return

    setSidebarFilter((prev) => (prev.resourceType === routeResourceType ? prev : { resourceType: routeResourceType }))
    setActiveTag(null)
    if (routeResourceType !== 'assistant') {
      setActiveAssistantCatalogTab(ASSISTANT_CATALOG_MY_TAB)
    }
  }, [routeResourceType])

  useEffect(() => {
    if (routeAction !== 'create' || !routeResourceType) return

    if (routeResourceType === 'assistant') {
      setConfigView((prev) => (prev.type === 'assistant-create' ? prev : { type: 'assistant-create' }))
    } else if (routeResourceType === 'agent') {
      setConfigView((prev) => (prev.type === 'agent-create' ? prev : { type: 'agent-create' }))
    } else if (routeResourceType === 'prompt') {
      setConfigView((prev) => (prev.type === 'prompt-create' ? prev : { type: 'prompt-create' }))
    }
  }, [routeAction, routeResourceType])

  useEffect(() => {
    if (routeAction !== 'edit' || !routeResourceType || !routeResourceId) return

    const resource = allResources.find((r) => r.type === routeResourceType && r.id === routeResourceId)
    if (!resource) return

    if (resource.type === 'assistant') {
      const assistant = resource.raw
      setConfigView((prev) =>
        prev.type === 'assistant-edit' && prev.assistant.id === assistant.id
          ? prev
          : { type: 'assistant-edit', assistant }
      )
    } else if (resource.type === 'agent') {
      const agent = resource.raw
      setConfigView((prev) =>
        prev.type === 'agent-edit' && prev.agent.id === agent.id ? prev : { type: 'agent-edit', agent }
      )
    } else if (resource.type === 'prompt') {
      const prompt = resource.raw
      setConfigView((prev) =>
        prev.type === 'prompt-edit' && prev.prompt.id === prompt.id ? prev : { type: 'prompt-edit', prompt }
      )
    }
  }, [allResources, routeAction, routeResourceId, routeResourceType])

  const handleEdit = useCallback((r: ResourceItem) => {
    if (r.type === 'assistant') {
      setConfigView({ type: 'assistant-edit', assistant: r.raw })
    } else if (r.type === 'agent') {
      setConfigView({ type: 'agent-edit', agent: r.raw })
    } else if (r.type === 'skill') {
      setConfigView({ type: 'skill-detail', skill: r.raw })
    } else if (r.type === 'prompt') {
      setConfigView({ type: 'prompt-edit', prompt: r.raw })
    }
  }, [])

  const handleDuplicate = useCallback(
    async (r: ResourceItem) => {
      if (r.type === 'assistant') {
        await duplicateAssistant(r.raw)
      }
    },
    [duplicateAssistant]
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
      // Mirror the agent create flow: enter the form first, then POST only
      // after the user fills the required fields and clicks Save.
      setConfigView({ type: 'assistant-create' })
    } else if (type === 'agent') {
      // Defer DB write until the user saves in the config page. This
      // avoids leaving half-configured agent rows behind if the user navigates away.
      setConfigView({ type: 'agent-create' })
    } else if (type === 'skill') {
      // Skill install lives in a dialog (mirrors ImportAssistantDialog) so the
      // ZIP / directory / marketplace flows from Settings → Skills can be exposed
      // here without leaving the library page.
      setSkillImportOpen(true)
    } else if (type === 'prompt') {
      setConfigView({ type: 'prompt-create' })
    }
  }, [])

  const handleAssistantTabChange = useCallback((tabId: string) => {
    setActiveAssistantCatalogTab(tabId)
    setActiveTag(null)
  }, [])

  const assistantCatalogProp = useMemo(
    () =>
      isAssistantLibrary
        ? {
            activeTab: effectiveActiveAssistantCatalogTab,
            tabs: assistantCatalog.tabs,
            presets: effectiveActiveAssistantCatalogTab === activeAssistantCatalogTab ? assistantCatalog.presets : [],
            onTabChange: handleAssistantTabChange,
            onAddPreset: handleAddAssistantPreset,
            onPreviewPreset: handlePreviewAssistantPreset
          }
        : undefined,
    [
      activeAssistantCatalogTab,
      assistantCatalog.presets,
      assistantCatalog.tabs,
      effectiveActiveAssistantCatalogTab,
      handleAddAssistantPreset,
      handleAssistantTabChange,
      handlePreviewAssistantPreset,
      isAssistantLibrary
    ]
  )

  if (configView.type === 'assistant-create') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="assistant-create"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex min-h-0 flex-1 flex-col bg-background">
          <AssistantConfigPage onBack={handleBackToList} onCreated={handleCreated} />
        </motion.div>
      </AnimatePresence>
    )
  }

  if (configView.type === 'assistant-edit') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`edit-${configView.assistant.id}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex min-h-0 flex-1 flex-col bg-background">
          <AssistantConfigPage assistant={configView.assistant} onBack={handleBackToList} />
        </motion.div>
      </AnimatePresence>
    )
  }

  if (configView.type === 'agent-edit') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`agent-edit-${configView.agent.id}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex min-h-0 flex-1 flex-col bg-background">
          <AgentConfigPage agent={configView.agent} onBack={handleBackToList} />
        </motion.div>
      </AnimatePresence>
    )
  }

  if (configView.type === 'agent-create') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="agent-create"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex min-h-0 flex-1 flex-col bg-background">
          <AgentConfigPage onBack={handleBackToList} onCreated={handleCreated} />
        </motion.div>
      </AnimatePresence>
    )
  }

  if (configView.type === 'prompt-create') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="prompt-create"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex min-h-0 flex-1 flex-col bg-background">
          <PromptConfigPage onBack={handleBackToList} onCreated={handleCreated} />
        </motion.div>
      </AnimatePresence>
    )
  }

  if (configView.type === 'prompt-edit') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`prompt-edit-${configView.prompt.id}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex min-h-0 flex-1 flex-col bg-background">
          <PromptConfigPage prompt={configView.prompt} onBack={handleBackToList} />
        </motion.div>
      </AnimatePresence>
    )
  }

  if (configView.type === 'skill-detail') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`skill-detail-${configView.skill.id}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex min-h-0 flex-1 flex-col bg-background">
          <SkillDetailPage
            skill={configView.skill}
            onBack={handleBackToList}
            onUninstalled={() => {
              refetch()
              setConfigView({ type: 'list' })
            }}
          />
        </motion.div>
      </AnimatePresence>
    )
  }

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
          if (routeAction || routeResourceType) {
            void navigate({ to: LIBRARY_ROUTE, search: buildLibraryListSearch(f.resourceType), replace: true })
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
              className="max-w-lg rounded-xs px-4 py-3 shadow-none"
            />
          </div>
        ) : (
          <ResourceGrid
            resources={resources}
            activeResourceType={activeResourceType}
            search={search}
            onSearchChange={setSearch}
            onEdit={handleEdit}
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
              // rows; binding stays inside card/editor tag hooks.
              await ensureTags([tagName])
            }}
            onUpdateResourceTags={noop /* binding is executed inside FixedCardMenu via the tag hooks */}
            allTagNames={allTagNames}
            assistantCatalog={assistantCatalogProp}
          />
        )}
      </div>

      <DeleteConfirmDialog resource={deleteConfirm} onClose={() => setDeleteConfirm(null)} />
      <AssistantPresetPreviewDialog
        preset={previewAssistantPreset}
        open={Boolean(previewAssistantPreset)}
        adding={previewAssistantPresetAdding}
        onOpenChange={handlePreviewOpenChange}
        onAdd={handleAddPreviewAssistantPreset}
      />
      <ImportAssistantDialog open={assistantImportOpen} onOpenChange={setAssistantImportOpen} onImported={refetch} />
      <ImportSkillDialog open={skillImportOpen} onOpenChange={setSkillImportOpen} onInstalled={refetch} />
    </div>
  )
}
