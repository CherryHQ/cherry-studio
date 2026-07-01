import { Alert, Button } from '@cherrystudio/ui'
import {
  AgentEditDialog,
  AssistantEditDialog,
  ImportAssistantDialog,
  ImportSkillDialog,
  PromptEditDialog,
  ResourceCreateWizard,
  type ResourceCreateWizardKind,
  type ResourceCreateWizardValues,
  ResourceDeleteConfirmDialog,
  SkillDetailDialog
} from '@renderer/components/resource/dialogs'
import { isSelectableAssistantModel } from '@renderer/components/resource/dialogs/form/assistantModelFilter'
import { DEFAULT_TAG_COLOR, getRandomTagColor } from '@renderer/components/resource/resourceCatalogConstants'
import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import {
  useAgentMutations,
  useAssistantMutations,
  usePromptMutations,
  usePromptMutationsById
} from '@renderer/hooks/resourceCatalog'
import { useEnsureTags, useTagList } from '@renderer/hooks/useTags'
import type { AgentDetail, ResourceItem, ResourceType, TagItem } from '@renderer/types/resourceCatalog'
import { serializeAssistantForExport } from '@renderer/utils/assistantTransfer'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { InstalledSkill } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Prompt } from '@shared/data/types/prompt'
import type { Tag } from '@shared/data/types/tag'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AssistantLibraryDialog } from './AssistantLibraryDialog'
import { ResourceGrid } from './ResourceGrid'
import { useResourceLibrary } from './useResourceLibrary'

type EditDialogState = { kind: 'assistant'; resource: Assistant } | { kind: 'agent'; resource: AgentDetail }

type PromptDialogState = { prompt: Prompt | null } | null

const DIALOG_EXIT_ANIMATION_MS = 200

export type ResourceCatalogViewProps = {
  className?: string
  onOpenAssistantChat?: (assistantId: string) => void
  resourceType: ResourceType
}

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

export function ResourceCatalogView({ className, onOpenAssistantChat, resourceType }: ResourceCatalogViewProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<ResourceItem | null>(null)
  const [createDialogKind, setCreateDialogKind] = useState<ResourceCreateWizardKind | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialog, setEditDialog] = useState<EditDialogState | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [creatingResource, setCreatingResource] = useState(false)
  const [promptDialog, setPromptDialog] = useState<PromptDialogState>(null)
  const [selectedSkill, setSelectedSkill] = useState<InstalledSkill | null>(null)
  const [assistantImportOpen, setAssistantImportOpen] = useState(false)
  const [assistantLibraryOpen, setAssistantLibraryOpen] = useState(false)
  const [skillImportOpen, setSkillImportOpen] = useState(false)

  const activeResourceType = resourceType
  const isAssistantLibrary = activeResourceType === 'assistant'

  const {
    resources,
    allResources,
    isLoading,
    error: resourceError,
    refetch
  } = useResourceLibrary({
    resourceType: activeResourceType,
    activeTag: isAssistantLibrary ? activeTag : null,
    search,
    sort: 'name'
  })

  const assistantTagUiEnabled = isAssistantLibrary

  useEffect(() => {
    setActiveTag(null)
  }, [resourceType])

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
    if (createDialogOpen || !createDialogKind) return

    const timeoutId = window.setTimeout(() => setCreateDialogKind(null), DIALOG_EXIT_ANIMATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [createDialogKind, createDialogOpen])

  useEffect(() => {
    if (editDialogOpen || !editDialog) return

    const timeoutId = window.setTimeout(() => setEditDialog(null), DIALOG_EXIT_ANIMATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [editDialog, editDialogOpen])

  const handleOpenResource = useCallback((r: ResourceItem) => {
    if (r.type === 'assistant') {
      setEditDialog({ kind: 'assistant', resource: r.raw })
      setEditDialogOpen(true)
    } else if (r.type === 'agent') {
      setEditDialog({ kind: 'agent', resource: r.raw })
      setEditDialogOpen(true)
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
      setCreateDialogOpen(true)
    } else if (type === 'agent') {
      setCreateDialogKind('agent')
      setCreateDialogOpen(true)
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

  return (
    <div className={cn('flex min-h-0 flex-1 bg-background', className)}>
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
            onOpenAssistantLibrary={isAssistantLibrary ? () => setAssistantLibraryOpen(true) : undefined}
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
          />
        )}
      </div>

      <ResourceDeleteConfirmDialog resource={deleteConfirm} onClose={() => setDeleteConfirm(null)} />
      <SkillDetailDialog
        skill={selectedSkill}
        open={Boolean(selectedSkill)}
        onOpenChange={(open) => {
          if (!open) setSelectedSkill(null)
        }}
      />
      <ImportAssistantDialog open={assistantImportOpen} onOpenChange={setAssistantImportOpen} onImported={refetch} />
      {isAssistantLibrary ? (
        <AssistantLibraryDialog
          open={assistantLibraryOpen}
          onOpenChange={setAssistantLibraryOpen}
          onAssistantAdded={refetch}
          onOpenAssistantChat={onOpenAssistantChat}
        />
      ) : null}
      <ImportSkillDialog open={skillImportOpen} onOpenChange={setSkillImportOpen} onInstalled={refetch} />
      <ResourceCreateWizard
        kind={createDialogKind ?? 'assistant'}
        open={createDialogOpen}
        isSubmitting={creatingResource}
        modelFilter={createDialogKind === 'agent' ? agentModelFilter : isSelectableAssistantModel}
        onOpenChange={handleCreateDialogOpenChange}
        onSubmit={handleSubmitCreateResource}
      />
      {editDialog?.kind === 'assistant' ? (
        <AssistantEditDialog
          open={editDialogOpen}
          resource={editDialog.resource}
          modelFilter={isSelectableAssistantModel}
          onOpenChange={handleEditDialogOpenChange}
          onSaved={handleEditSaved}
        />
      ) : null}
      {editDialog?.kind === 'agent' ? (
        <AgentEditDialog
          open={editDialogOpen}
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
