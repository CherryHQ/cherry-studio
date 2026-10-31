import { FileText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, EmojiIcon, EmptyState, Spinner } from '@cherrystudio/ui'
import { useDataChange, useQuery } from '@data/hooks/useDataApi'
import {
  ResourceEditDialogHost,
  type ResourceEditDialogTarget
} from '@renderer/components/resourceCatalog/dialogs/edit'
import { getAgentAvatarFromConfiguration, getAgentDescriptionForDisplay } from '@renderer/utils/agent'
import type { Prompt } from '@shared/data/types/prompt'

import type { LibraryResourceKind } from './LibraryCreateDialog'
import { LibraryResourceDetailDialog } from './LibraryResourceDetailDialog'
import { type LibraryItem, LibraryResourceMenu } from './LibraryResourceMenu'
import type { LibraryFilters } from './MyResourcesFilter'
import type { SkillLibraryTagManager } from './useSkillLibraryTags'

export function LibraryLoadError({ retry }: { retry: () => Promise<unknown> }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="col-span-full flex items-center justify-center gap-3 text-sm text-error">
      {t('common.error')}
      <Button variant="outline" onClick={() => void retry().catch(() => undefined)}>
        {t('common.retry')}
      </Button>
    </div>
  )
}

export function LibraryResourceList({
  kind,
  query,
  sort,
  tagIds,
  prompts,
  manager
}: {
  kind: LibraryResourceKind
  query: string
  sort: LibraryFilters['sort']
  tagIds: string[]
  prompts: Prompt[]
  manager: SkillLibraryTagManager
}) {
  const { t, i18n } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<ResourceEditDialogTarget | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return prompts
      .filter((prompt) => `${prompt.title} ${prompt.content}`.toLocaleLowerCase().includes(search))
      .filter(
        (prompt) => !tagIds.length || tagIds.some((id) => manager.assignments[`prompt:${prompt.id}`]?.includes(id))
      )
      .sort((a, b) =>
        sort === 'name'
          ? a.title.localeCompare(b.title, i18n.language)
          : b[sort].localeCompare(a[sort]) || a.id.localeCompare(b.id)
      )
  }, [prompts, query, sort, tagIds, manager.assignments, i18n.language])
  const open = (id: string, element: HTMLButtonElement) => {
    trigger.current = element
    if (kind !== 'prompt') setEditTarget({ kind, id })
    else setSelectedId(id)
  }
  return (
    <>
      <div className="grid grid-cols-1 gap-3 @[440px]:grid-cols-2 @[680px]:grid-cols-3 @[920px]:grid-cols-4 @[1160px]:grid-cols-5">
        {kind !== 'prompt' ? (
          <ConversationOwnerPage
            kind={kind}
            page={1}
            query={query}
            sort={sort}
            tagIds={tagIds}
            onOpen={open}
            manager={manager}
          />
        ) : visible.length ? (
          visible.map((prompt) => (
            <LibraryCard
              key={prompt.id}
              resource={{
                ...prompt,
                type: 'prompt',
                name: prompt.title,
                description: prompt.content.replace(/\s+/g, ' ').trim(),
                avatar: '',
                raw: prompt
              }}
              manager={manager}
              onOpen={(element) => open(prompt.id, element)}
            />
          ))
        ) : (
          <div className="col-span-full">
            <EmptyState
              title={t(
                query.trim() || tagIds.length ? 'library.empty_state.no_match_title' : 'library.empty_state.title'
              )}
            />
          </div>
        )}
      </div>
      {selectedId ? (
        <LibraryResourceDetailDialog
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onReturnFocus={() => trigger.current?.focus()}
        />
      ) : null}
      <ResourceEditDialogHost
        requireConfirmation
        preventOutsideClose
        target={editTarget}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null)
            trigger.current?.focus()
          }
        }}
      />
    </>
  )
}

function LibraryCard({
  resource,
  manager,
  onOpen
}: {
  resource: LibraryItem
  manager: SkillLibraryTagManager
  onOpen: (element: HTMLButtonElement) => void
}) {
  const { t } = useTranslation()
  const description =
    resource.description.trim() || (resource.type === 'prompt' ? '—' : t('marketplace.edit_config_hint'))
  return (
    <div className="group flex min-w-0 items-center rounded-2xl border border-border-subtle transition-[box-shadow,translate] duration-200 ease-out hover:shadow-md motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none">
      <Button
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start gap-3 rounded-2xl p-3 text-left hover:bg-transparent"
        onClick={(event) => onOpen(event.currentTarget)}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent">
          {resource.avatar ? (
            <EmojiIcon emoji={resource.avatar} size={20} />
          ) : (
            <FileText className="size-4 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{resource.name}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
        </span>
      </Button>
      <LibraryResourceMenu resource={resource} manager={manager} />
    </div>
  )
}

function ConversationOwnerPage({
  kind,
  page,
  query,
  sort,
  tagIds,
  onOpen,
  manager
}: {
  kind: 'assistant' | 'agent'
  page: number
  query: string
  sort: LibraryFilters['sort']
  tagIds: string[]
  onOpen: (id: string, element: HTMLButtonElement) => void
  manager: SkillLibraryTagManager
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const limit = 30
  const params = {
    page,
    limit,
    inTrash: false,
    sortBy: sort,
    sortOrder: sort === 'name' ? ('asc' as const) : ('desc' as const),
    ...(tagIds.length ? { libraryTagIds: tagIds } : {}),
    ...(query.trim() ? { search: query.trim() } : {})
  }
  const assistants = useQuery('/assistants', {
    enabled: kind === 'assistant',
    query: params
  })
  const agents = useQuery('/agents', { enabled: kind === 'agent', query: params })
  const { data, isLoading, error, refetch } = kind === 'agent' ? agents : assistants
  useDataChange(kind === 'agent' ? '/agents' : '/assistants', () => void refetch())
  const previousAssignments = useRef(manager.assignments)
  useEffect(() => {
    if (previousAssignments.current !== manager.assignments && tagIds.length) void refetch()
    previousAssignments.current = manager.assignments
  }, [manager.assignments, refetch, tagIds.length])
  if (error) return <LibraryLoadError retry={refetch} />
  if (isLoading || !data)
    return (
      <div className="col-span-full">
        <Spinner text={t('common.loading')} />
      </div>
    )
  if (!data.total)
    return (
      <div className="col-span-full">
        <EmptyState
          title={t(query.trim() || tagIds.length ? 'library.empty_state.no_match_title' : 'library.empty_state.title')}
        />
      </div>
    )
  const resources: LibraryItem[] =
    kind === 'agent'
      ? (agents.data?.items ?? []).map((agent) => ({
          ...agent,
          type: 'agent',
          model: agent.modelName ?? undefined,
          avatar: getAgentAvatarFromConfiguration(agent.configuration),
          description: getAgentDescriptionForDisplay(agent, t),
          raw: agent
        }))
      : (assistants.data?.items ?? []).map((assistant) => ({
          ...assistant,
          type: 'assistant',
          avatar: assistant.emoji,
          groupId: assistant.groupId ?? undefined,
          raw: assistant
        }))
  return (
    <>
      {resources.map((resource) => (
        <LibraryCard
          key={resource.id}
          resource={resource}
          manager={manager}
          onOpen={(element) => onOpen(resource.id, element)}
        />
      ))}
      {page * limit < data.total ? (
        expanded ? (
          <ConversationOwnerPage
            kind={kind}
            page={page + 1}
            query={query}
            sort={sort}
            tagIds={tagIds}
            onOpen={onOpen}
            manager={manager}
          />
        ) : (
          <div className="col-span-full flex justify-center py-3">
            <Button variant="outline" onClick={() => setExpanded(true)}>
              {t('settings.usage.explore.loadMore')}
            </Button>
          </div>
        )
      ) : null}
    </>
  )
}
