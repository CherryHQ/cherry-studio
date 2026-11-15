import { Film, Globe, ImageIcon, Music } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { loggerService } from '@logger'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { ImagePreviewService } from '@renderer/services/ImagePreviewService'
import { formatFileSize } from '@renderer/utils/file'
import { cn } from '@renderer/utils/style'
import { getLocaleFirstDayOfWeek } from '@renderer/utils/time'
import {
  ARTIFACT_LIST_LIMIT,
  type ArtifactEntity,
  type ArtifactKind,
  type ArtifactList
} from '@shared/data/api/schemas/artifacts'
import { type FileHandle, FileEntryIdSchema } from '@shared/data/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFileEntryHandle, createFilePathHandle, getFileTypeByExt, toSafeFileUrl } from '@shared/utils/file'

import { ProfilePaneSection } from './ProfilePaneParts'

const logger = loggerService.withContext('ProfileOutputs')

type OutputsFilter = 'all' | ArtifactKind
type OutputsGroup = 'today' | 'week' | 'earlier'

const FILTERS: readonly { value: OutputsFilter; label: string }[] = [
  { value: 'all', label: 'common.all' },
  { value: 'page', label: 'chat.profile_pane.outputs.filter.page' },
  { value: 'media', label: 'chat.profile_pane.outputs.filter.media' },
  { value: 'file', label: 'chat.profile_pane.outputs.filter.file' }
]
const GROUPS: readonly { value: OutputsGroup; label: string }[] = [
  { value: 'today', label: 'chat.profile_pane.outputs.group.today' },
  { value: 'week', label: 'chat.profile_pane.outputs.group.week' },
  { value: 'earlier', label: 'chat.profile_pane.outputs.group.earlier' }
]

/** Everything the Agent reported as a deliverable; a click opens it in the Files pane. */
export function AgentOutputs({ agentId, onOpen }: { agentId: string; onOpen?: (path: string) => void }) {
  const [filter, setFilter] = useState<OutputsFilter>('all')
  const { data, refetch } = useQuery('/agents/:agentId/artifacts', {
    params: { agentId },
    query: filter === 'all' ? {} : { kind: filter },
    // Keeps the list in place while another kind loads.
    swrOptions: { keepPreviousData: true }
  })
  useDataChange('/agents/:agentId/artifacts', () => void refetch(), { routeParams: { agentId } })

  return (
    <OutputsList
      list={data}
      filter={filter}
      onFilterChange={setFilter}
      emptyHint="chat.profile_pane.outputs.empty.agent"
      untitledSource="agent.session.new"
      onOpen={onOpen ? (item) => item.path && onOpen(item.path) : undefined}
    />
  )
}

/** Images the Assistant generated in its topics; a click previews the image. */
export function AssistantOutputs({ assistantId }: { assistantId: string }) {
  const [filter, setFilter] = useState<OutputsFilter>('all')
  const { data, refetch } = useQuery('/assistants/:id/artifacts', {
    params: { id: assistantId },
    query: filter === 'all' ? {} : { kind: filter },
    // Keeps the list in place while another kind loads.
    swrOptions: { keepPreviousData: true }
  })
  useDataChange('/assistants/:id/artifacts', () => void refetch(), { routeParams: { id: assistantId } })

  return (
    <OutputsList
      list={data}
      filter={filter}
      onFilterChange={setFilter}
      emptyHint="chat.profile_pane.outputs.empty.assistant"
      untitledSource="chat.default.topic.name"
      onOpen={previewImage}
    />
  )
}

async function previewImage(item: ArtifactEntity) {
  const entryId = FileEntryIdSchema.safeParse(item.fileEntryId)
  if (!entryId.success) return
  try {
    const paths = await ipcApi.request('file.batch_get_physical_paths', { ids: [entryId.data] })
    const path = paths[entryId.data]
    if (path) await ImagePreviewService.show(toSafeFileUrl(path, null))
  } catch (error) {
    logger.warn('Failed to preview generated image', { id: item.fileEntryId, error })
  }
}

function OutputsList({
  list,
  filter,
  onFilterChange,
  emptyHint,
  untitledSource,
  onOpen
}: {
  list?: ArtifactList
  filter: OutputsFilter
  onFilterChange: (filter: OutputsFilter) => void
  emptyHint: string
  /** What the source conversation is called before it has a name. */
  untitledSource: string
  onOpen?: (item: ArtifactEntity) => void
}) {
  const { t, i18n } = useTranslation()
  const missing = useMissingOutputs(list?.items ?? [])
  if (!list) return null

  if (!list.counts.all) {
    return (
      <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
        <span className="text-foreground text-sm">{t('chat.profile_pane.outputs.empty.title')}</span>
        <span className="text-muted-foreground text-xs">{t(emptyHint)}</span>
      </div>
    )
  }

  const now = new Date()
  const firstDayOfWeek = getLocaleFirstDayOfWeek(i18n.language)
  const grouped = Map.groupBy(list.items, (item) => groupOf(new Date(item.reportedAt), now, firstDayOfWeek))

  return (
    <>
      <div className="flex items-center gap-1">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => onFilterChange(option.value)}
            className={cn(
              'h-6 rounded-md px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              filter === option.value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}>
            {t(option.label)}
          </button>
        ))}
        <span className="ml-auto pr-1 text-foreground-tertiary text-xs">
          {t('chat.profile_pane.outputs.count', { count: list.counts[filter] })}
          {list.counts[filter] > ARTIFACT_LIST_LIMIT
            ? ` · ${t('chat.profile_pane.outputs.latest_shown', { count: ARTIFACT_LIST_LIMIT })}`
            : null}
        </span>
      </div>
      {GROUPS.map((group) => {
        const items = grouped.get(group.value)
        if (!items?.length) return null
        return (
          <ProfilePaneSection key={group.value} title={t(group.label)}>
            {items.map((item) => (
              <OutputRow
                key={item.id}
                item={item}
                time={formatTime(new Date(item.reportedAt), group.value, now, i18n.language)}
                unavailable={missing.has(item.id)}
                untitledSource={untitledSource}
                onOpen={onOpen}
              />
            ))}
          </ProfilePaneSection>
        )
      })}
    </>
  )
}

function OutputRow({
  item,
  time,
  unavailable,
  untitledSource,
  onOpen
}: {
  item: ArtifactEntity
  time: string
  unavailable: boolean
  untitledSource: string
  onOpen?: (item: ArtifactEntity) => void
}) {
  const { t } = useTranslation()
  const extension = getExtension(item.path ?? item.title)
  // A page reads by its title; a file or media item is known by its file name.
  const name = item.kind !== 'page' && item.path ? getBaseName(item.path) : item.title
  const meta = unavailable
    ? t('chat.profile_pane.outputs.unavailable')
    : item.kind === 'page'
      ? t('chat.profile_pane.outputs.page_meta', { source: item.sourceName || t(untitledSource) })
      : [extension.toUpperCase() || t('chat.input.tools.file_type.file'), item.size && formatFileSize(item.size)]
          .filter(Boolean)
          .join(' · ')

  return (
    <button
      type="button"
      disabled={unavailable || !onOpen}
      onClick={() => onOpen?.(item)}
      title={[item.title, item.path].filter(Boolean).join('\n')}
      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent">
      <OutputThumb kind={item.kind} extension={extension} />
      <span className={cn('flex min-w-0 flex-1 flex-col', unavailable && 'opacity-50')}>
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] text-foreground leading-[18px]">{name}</span>
          <span className="shrink-0 text-[11px] text-foreground-tertiary">{time}</span>
        </span>
        <span className="truncate text-[11px] text-muted-foreground leading-4">{meta}</span>
      </span>
    </button>
  )
}

function OutputThumb({ kind, extension }: { kind: ArtifactKind; extension: string }) {
  const box = 'flex size-7 shrink-0 items-center justify-center rounded-md bg-muted'
  if (kind === 'file') {
    return (
      <span className={cn(box, 'font-semibold text-[8px] text-muted-foreground')}>
        {extension.slice(0, 4).toUpperCase()}
      </span>
    )
  }
  const type = getFileTypeByExt(extension)
  const Icon = kind === 'page' ? Globe : type === 'audio' ? Music : type === 'video' ? Film : ImageIcon
  return (
    <span className={cn(box, kind === 'media' && 'bg-linear-to-br from-muted to-accent')}>
      <Icon className="size-3.5 text-muted-foreground" />
    </span>
  )
}

/** Outputs whose file is gone; checked once per listed set, so a deleted file shows as unavailable. */
function useMissingOutputs(items: readonly ArtifactEntity[]): ReadonlySet<string> {
  const handles = items.flatMap((item): { key: string; handle: FileHandle }[] => {
    const entryId = FileEntryIdSchema.safeParse(item.fileEntryId)
    if (entryId.success) return [{ key: item.id, handle: createFileEntryHandle(entryId.data) }]
    const path = AbsoluteFilePathSchema.safeParse(item.path)
    return path.success ? [{ key: item.id, handle: createFilePathHandle(path.data) }] : []
  })
  const { data } = useSWR(
    handles.length ? ['profile-outputs-metadata', handles.map((item) => item.key).join(',')] : null,
    () => ipcApi.request('file.batch_get_metadata', { items: handles })
  )
  return new Set(data ? Object.keys(data).filter((key) => data[key] === null) : [])
}

function getBaseName(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath
}

function getExtension(name: string): string {
  const base = getBaseName(name)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

function groupOf(date: Date, now: Date, firstDayOfWeek: number): OutputsGroup {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (date >= today) return 'today'
  const weekStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - ((today.getDay() - firstDayOfWeek + 7) % 7)
  )
  return date >= weekStart ? 'week' : 'earlier'
}

function formatTime(date: Date, group: OutputsGroup, now: Date, language: string): string {
  const options: Intl.DateTimeFormatOptions =
    group === 'today'
      ? { hour: '2-digit', minute: '2-digit' }
      : group === 'week'
        ? { weekday: 'short' }
        : { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }) }
  return new Intl.DateTimeFormat(language, options).format(date)
}
