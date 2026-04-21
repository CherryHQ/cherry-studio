import type { Assistant } from '@shared/data/types/assistant'
import type { Tag } from '@shared/data/types/tag'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistantMutations } from './adapters/assistantAdapter'
import { useEnsureTags, useTagList } from './adapters/tagAdapter'
import AssistantConfigPage from './AssistantConfig/AssistantConfigPage'
import { serializeAssistantForExport } from './assistantTransfer'
import { DeleteConfirmDialog } from './components/DeleteConfirmDialog'
import { ImportAssistantDialog } from './components/ImportAssistantDialog'
import { LibrarySidebar } from './components/LibrarySidebar'
import PendingBackendNotice from './components/PendingBackendNotice'
import { ResourceGrid } from './components/ResourceGrid'
import { DEFAULT_TAG_COLOR } from './constants'
import type { LibrarySidebarFilter, ResourceItem, ResourceType, SortKey, TagItem, ViewMode } from './types'
import { useResourceLibrary } from './useResourceLibrary'

type ConfigView = { type: 'list' } | { type: 'assistant-edit'; assistant: Assistant }

// Baseline for「新建助手」. `modelId` is intentionally omitted — the backend
// fills it from the `chat.default_model_id` preference (AssistantService
// `resolveCreateModelId`). If the preference is unset or points at a model
// the user has since removed, create falls back to `null`; the user can pick
// a model in the edit page afterwards.
const DEFAULT_NEW_ASSISTANT_BASE = {
  name: '新助手',
  emoji: '💬',
  description: '',
  prompt: ''
} as const

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
  const [sidebarFilter, setSidebarFilter] = useState<LibrarySidebarFilter>({ type: 'all' })
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<ResourceItem | null>(null)
  const [configView, setConfigView] = useState<ConfigView>({ type: 'list' })
  const [assistantImportOpen, setAssistantImportOpen] = useState(false)

  const { resources, allResources, typeCounts, pendingBackend, refetch } = useResourceLibrary({
    sidebarFilter,
    activeType: null,
    activeTag,
    search,
    sort: sortKey
  })

  const { createAssistant, duplicateAssistant } = useAssistantMutations()
  // Row 2「+ 标签」走 ensureTags 的幂等语义:已存在则静默复用,不存在才 POST。
  // Avoids 409 on duplicate names and keeps the UX consistent with BasicSection / 卡片菜单。
  const { ensureTags } = useEnsureTags()
  // Single source of truth for "what tags exist anywhere" — backs the selection
  // pools (card menu / BasicSection) and feeds chip colors. Revalidated by the
  // `refresh: ['/tags']` side-effect on createTag / ensureTags.
  const tagList = useTagList()

  const activeResourceType = sidebarFilter.type === 'resource' ? sidebarFilter.resourceType : undefined
  const scopedTags = useMemo(
    () => buildTags(allResources, tagList.tags, activeResourceType),
    [allResources, tagList.tags, activeResourceType]
  )

  // Selection pool includes *every* tag that exists server-side — even ones
  // that have never been bound to an assistant, so a newly-created tag from
  // Row 2's "+ 标签" button is immediately pickable in the card menu.
  const allTagNames = useMemo(
    () => tagList.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b, 'zh')),
    [tagList.tags]
  )

  const noop = useCallback(() => {}, [])

  const handleEdit = useCallback((r: ResourceItem) => {
    if (r.type === 'assistant') {
      setConfigView({ type: 'assistant-edit', assistant: r.raw as Assistant })
    }
  }, [])

  const handleDuplicate = useCallback(
    async (r: ResourceItem) => {
      if (r.type !== 'assistant') return
      await duplicateAssistant(r.raw as Assistant)
    },
    [duplicateAssistant]
  )

  const handleDelete = useCallback((r: ResourceItem) => setDeleteConfirm(r), [])

  const handleExport = useCallback(
    async (r: ResourceItem) => {
      if (r.type !== 'assistant') return

      const assistant = r.raw as Assistant
      try {
        const content = serializeAssistantForExport(assistant)

        await window.api.file.save(`${assistant.name}.json`, new TextEncoder().encode(content), {
          filters: [{ name: t('assistants.presets.import.file_filter'), extensions: ['json'] }]
        })
      } catch (error) {
        // Export-specific fallback message — avoids the previous import.error
        // reuse which mislabelled failures as "导入失败".
        window.toast.error(error instanceof Error ? error.message : '导出助手失败')
      }
    },
    [t]
  )

  const handleCreate = useCallback(
    async (type: ResourceType) => {
      if (type !== 'assistant') return
      // Create the row up-front so the edit page opens against a real id.
      // modelId is omitted here so the backend can fill it from
      // `chat.default_model_id` (see DEFAULT_NEW_ASSISTANT_BASE above).
      const created = await createAssistant({ ...DEFAULT_NEW_ASSISTANT_BASE, name: t('library.type.new_assistant') })
      setConfigView({ type: 'assistant-edit', assistant: created })
    },
    [createAssistant, t]
  )

  if (configView.type === 'assistant-edit') {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`edit-${configView.assistant.id}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex min-h-0 flex-1 flex-col bg-background">
          <AssistantConfigPage assistant={configView.assistant} onBack={() => setConfigView({ type: 'list' })} />
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
        }}
        typeCounts={typeCounts}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {pendingBackend && <PendingBackendNotice />}
        <ResourceGrid
          resources={resources}
          viewMode={viewMode}
          sortKey={sortKey}
          search={search}
          onSearchChange={setSearch}
          onViewModeChange={setViewMode}
          onSortKeyChange={setSortKey}
          onEdit={handleEdit}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onExport={(resource) => {
            void handleExport(resource)
          }}
          onToggle={noop}
          onCreate={handleCreate}
          onImportAssistant={() => setAssistantImportOpen(true)}
          tags={scopedTags}
          activeTag={activeTag}
          onTagFilter={setActiveTag}
          onAddTag={async (tagName) => {
            // Idempotent: ensureTags reuses an existing tag when the name already
            // exists (avoiding 409), or POSTs a new row with a random palette
            // color otherwise. Either path triggers `/tags` refresh so the card
            // menu / BasicSection selection pool picks the name up immediately.
            // The Row 2 chip list remains bound to buildTags(resources), so a
            // newly-created but unbound tag only surfaces after it is bound.
            await ensureTags([tagName])
          }}
          onUpdateResourceTags={noop /* binding is executed inside FixedCardMenu via the tag hooks */}
          allTagNames={allTagNames}
        />
      </div>

      <DeleteConfirmDialog resource={deleteConfirm} onClose={() => setDeleteConfirm(null)} />
      <ImportAssistantDialog open={assistantImportOpen} onOpenChange={setAssistantImportOpen} onImported={refetch} />
    </div>
  )
}
