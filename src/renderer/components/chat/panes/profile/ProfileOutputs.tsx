import { Film, Globe, ImageIcon, Music } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Button, Skeleton } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { ImagePreviewService } from '@renderer/services/ImagePreviewService'
import { formatFileSize } from '@renderer/utils/file'
import { cn } from '@renderer/utils/style'
import { getLocaleFirstDayOfWeek } from '@renderer/utils/time'
import type { ArtifactEntity, ArtifactKind, ArtifactList } from '@shared/data/api/schemas/artifacts'
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
  const { data, error, refetch } = useQuery('/agents/:agentId/artifacts', {
    params: { agentId },
    query: filter === 'all' ? {} : { kind: filter },
    // Keeps the list in place while another kind loads.
    swrOptions: { keepPreviousData: true }
  })
  useDataChange('/agents/:agentId/artifacts', () => void refetch(), { routeParams: { agentId } })

  return (
    <OutputsList
      list={data}
      failed={Boolean(error) && !data}
      onRetry={() => void refetch()}
      filter={filter}
      onFilterChange={setFilter}
      emptyHint="chat.profile_pane.outputs.empty.agent"
      delivers="page"
      onOpen={onOpen ? (item) => item.path && onOpen(item.path) : undefined}
    />
  )
}

/** Images the Assistant generated in its topics; a click previews the image. */
export function AssistantOutputs({ assistantId }: { assistantId: string }) {
  const [filter, setFilter] = useState<OutputsFilter>('all')
  const { data, error, refetch } = useQuery('/assistants/:id/artifacts', {
    params: { id: assistantId },
    query: filter === 'all' ? {} : { kind: filter },
    // Keeps the list in place while another kind loads.
    swrOptions: { keepPreviousData: true }
  })
  useDataChange('/assistants/:id/artifacts', () => void refetch(), { routeParams: { id: assistantId } })

  return (
    <OutputsList
      list={data}
      failed={Boolean(error) && !data}
      onRetry={() => void refetch()}
      filter={filter}
      onFilterChange={setFilter}
      emptyHint="chat.profile_pane.outputs.empty.assistant"
      delivers="image"
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
  failed,
  onRetry,
  filter,
  onFilterChange,
  emptyHint,
  delivers,
  onOpen
}: {
  list?: ArtifactList
  failed: boolean
  onRetry: () => void
  filter: OutputsFilter
  onFilterChange: (filter: OutputsFilter) => void
  emptyHint: string
  delivers: 'page' | 'image'
  onOpen?: (item: ArtifactEntity) => void
}) {
  const { t, i18n } = useTranslation()
  const missing = useMissingOutputs(list?.items ?? [])
  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <span className="text-muted-foreground text-xs">{t('chat.profile_pane.outputs.load_failed')}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  if (!list) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <span className="sr-only">{t('common.loading')}</span>
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-2/3 rounded-sm" />
              <Skeleton className="h-3 w-1/3 rounded-sm" />
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (!list.counts.all) return <OutputsEmpty hint={t(emptyHint)} delivers={delivers} />

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
  onOpen
}: {
  item: ArtifactEntity
  time: string
  unavailable: boolean
  onOpen?: (item: ArtifactEntity) => void
}) {
  const { t } = useTranslation()
  const extension = getExtension(item.path ?? item.title)
  const meta = unavailable
    ? t('chat.profile_pane.outputs.unavailable')
    : item.kind === 'page'
      ? t('chat.profile_pane.outputs.page_meta', { source: item.sourceName || t('chat.default.topic.name') })
      : [extension.toUpperCase() || t('chat.input.tools.file_type.file'), item.size && formatFileSize(item.size)]
          .filter(Boolean)
          .join(' · ')

  return (
    <button
      type="button"
      disabled={unavailable || !onOpen}
      onClick={() => onOpen?.(item)}
      title={item.path}
      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent">
      <OutputThumb kind={item.kind} extension={extension} />
      <span className={cn('flex min-w-0 flex-1 flex-col gap-0.5', unavailable && 'opacity-50')}>
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-foreground text-sm">{item.title}</span>
          <span className="shrink-0 text-foreground-tertiary text-xs">{time}</span>
        </span>
        <span className="truncate text-muted-foreground text-xs">{meta}</span>
      </span>
    </button>
  )
}

function OutputThumb({ kind, extension }: { kind: ArtifactKind; extension: string }) {
  const box = 'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted'
  if (kind === 'file') {
    return (
      <span className={cn(box, 'font-semibold text-[10px] text-muted-foreground tracking-wide')}>
        {extension.slice(0, 4).toUpperCase()}
      </span>
    )
  }
  const type = getFileTypeByExt(extension)
  const Icon = kind === 'page' ? Globe : type === 'audio' ? Music : type === 'video' ? Film : ImageIcon
  return (
    <span className={cn(box, kind === 'media' && 'bg-linear-to-br from-muted to-accent')}>
      <Icon className="size-4 text-muted-foreground" />
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

function getExtension(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? ''
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

/** The three output kinds the Outputs filter uses, as empty slots. */
const OUTPUT_SLOTS = [
  { kind: 'page', x: 23 },
  { kind: 'image', x: 49 },
  { kind: 'file', x: 75 }
] as const

function SlotGlyph({ kind, x }: { kind: 'page' | 'image' | 'file'; x: number }) {
  // Glyphs are drawn for the first slot (x = 23) and shifted to their own.
  return (
    <g transform={`translate(${x - 23} 0)`}>
      {kind === 'page' ? (
        <>
          <circle cx="34" cy="37" r="5" />
          <path d="M29 37h10M34 32a8 8 0 0 1 0 10M34 32a8 8 0 0 0 0 10" />
        </>
      ) : kind === 'image' ? (
        <>
          <rect x="29" y="32" width="10" height="10" rx="2" />
          <circle cx="32" cy="35.5" r="1" />
          <path d="m29 41 3.5-3.5 6.5 4.5" />
        </>
      ) : (
        <>
          <path d="M31 31.5h4l3 3v7a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
          <path d="M35 31.5v3h3" />
        </>
      )}
    </g>
  )
}

/**
 * The Outputs story: while the conversation types, a page (Agents) or an image (Assistants) rises
 * into its empty slot, which then takes on the brand tint. Neutral tokens plus one accent; the CSS
 * motion lives in the SVG so reduced motion stops it.
 */
function OutputsIllustration({ delivers }: { delivers: 'page' | 'image' }) {
  const id = useId().replace(/:/g, '')
  const slotX = OUTPUT_SLOTS.find((slot) => slot.kind === delivers)!.x - 23
  const line = { strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  const accent = 'var(--color-primary)'
  const muted = 'color-mix(in oklab, var(--color-muted-foreground) 70%, transparent)'

  return (
    <svg width="150" height="118" viewBox="12 14 96 76" fill="none" aria-hidden="true">
      <style>{`
        .${id}-card { animation: ${id}-rise 4s cubic-bezier(.25,.8,.25,1) infinite; filter: drop-shadow(0 4px 6px color-mix(in oklab, var(--color-foreground) 12%, transparent)) }
        .${id}-fill { animation: ${id}-fill 4s ease-out infinite; opacity: 0 }
        .${id}-dot { animation: ${id}-type 1.2s ease-in-out infinite; opacity: .35 }
        @keyframes ${id}-rise {
          0% { transform: translate(${26 - slotX}px, 38px) scale(.55); opacity: 0 }
          10% { opacity: 1 }
          40% { transform: translate(0, -1.5px); opacity: 1 }
          48%, 82% { transform: none; opacity: 1 }
          100% { transform: none; opacity: 0 }
        }
        @keyframes ${id}-fill { 0%, 40% { opacity: 0 } 52%, 84% { opacity: 1 } 100% { opacity: 0 } }
        @keyframes ${id}-type { 0%, 60%, 100% { opacity: .35 } 30% { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) { .${id}-card, .${id}-fill, .${id}-dot { animation: none } }
      `}</style>

      {/* Empty slots, one per output kind */}
      {OUTPUT_SLOTS.map(({ kind, x }) => (
        <g key={kind}>
          <rect
            x={x}
            y="26"
            width="22"
            height="22"
            rx="6"
            fill="color-mix(in oklab, var(--color-foreground) 3%, transparent)"
            stroke="color-mix(in oklab, var(--color-foreground) 18%, transparent)"
            strokeDasharray="2.4 2.4"
            strokeWidth="1.1"
          />
          <g stroke={muted} {...line}>
            <SlotGlyph kind={kind} x={x} />
          </g>
        </g>
      ))}
      <rect
        className={`${id}-fill`}
        x={23 + slotX - 2}
        y="24"
        width="26"
        height="26"
        rx="8"
        fill={`color-mix(in oklab, ${accent} 12%, transparent)`}
      />

      {/* What the conversation delivers */}
      <g transform={`translate(${slotX} 0)`}>
        <g className={`${id}-card`}>
          <rect
            x="23.5"
            y="26.5"
            width="21"
            height="21"
            rx="5.5"
            fill="var(--color-card)"
            stroke="color-mix(in oklab, var(--color-foreground) 14%, transparent)"
          />
          <g stroke={accent} {...line}>
            <SlotGlyph kind={delivers} x={23} />
          </g>
        </g>
      </g>

      {/* The conversation it comes from, still typing */}
      <path
        d="M40 64h40a7 7 0 0 1 7 7v6a7 7 0 0 1-7 7H63l-6 5v-5H40a7 7 0 0 1-7-7v-6a7 7 0 0 1 7-7Z"
        fill="var(--color-card)"
        stroke="color-mix(in oklab, var(--color-foreground) 14%, transparent)"
      />
      <g fill="var(--color-muted-foreground)">
        {[51, 60, 69].map((cx, index) => (
          <circle
            key={cx}
            className={`${id}-dot`}
            cx={cx}
            cy="74"
            r="1.6"
            style={{ animationDelay: `${index * 0.18}s` }}
          />
        ))}
      </g>
    </svg>
  )
}

function OutputsEmpty({ hint, delivers }: { hint: string; delivers: 'page' | 'image' }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center px-6 pt-8 pb-12 text-center">
      <OutputsIllustration delivers={delivers} />
      <span className="mt-4 text-foreground text-sm">{t('chat.profile_pane.outputs.empty.title')}</span>
      <span className="mt-1.5 max-w-60 text-muted-foreground text-xs leading-relaxed">{hint}</span>
    </div>
  )
}
