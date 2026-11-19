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
      untitledSource="agent.session.new"
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
  failed,
  onRetry,
  filter,
  onFilterChange,
  emptyHint,
  untitledSource,
  onOpen
}: {
  list?: ArtifactList
  failed: boolean
  onRetry: () => void
  filter: OutputsFilter
  onFilterChange: (filter: OutputsFilter) => void
  emptyHint: string
  /** What the source conversation is called before it has a name. */
  untitledSource: string
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
            <Skeleton className="size-7 shrink-0 rounded-md" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-2/3 rounded-sm" />
              <Skeleton className="h-3 w-1/3 rounded-sm" />
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (!list.counts.all) return <OutputsEmpty hint={t(emptyHint)} />

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

type Sprite = { x: number; y: number; tilt: number; fill: string; cells: readonly (readonly [number, number])[] }

/** Pixel sprites around the cards, each on a 4-unit grid. */
const SPRITES: readonly Sprite[] = [
  {
    x: 26,
    y: 94,
    tilt: -12,
    fill: 'fill-orange-500',
    cells: [
      [1, 0],
      [3, 0],
      [0, 1],
      [2, 1],
      [1, 2],
      [3, 2],
      [0, 3],
      [2, 3]
    ]
  },
  {
    x: 54,
    y: 34,
    tilt: 14,
    fill: 'fill-sky-500',
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 1],
      [0, 2],
      [2, 3],
      [3, 3]
    ]
  },
  {
    x: 110,
    y: 10,
    tilt: 18,
    fill: 'fill-amber-400',
    cells: [
      [0, 0],
      [3, 0],
      [1, 1],
      [2, 1],
      [1, 2],
      [0, 3],
      [3, 3]
    ]
  },
  {
    x: 166,
    y: 28,
    tilt: -16,
    fill: 'fill-emerald-500',
    cells: [
      [1, 0],
      [3, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [1, 2],
      [3, 2],
      [0, 3],
      [2, 3],
      [4, 3]
    ]
  },
  {
    x: 196,
    y: 82,
    tilt: 10,
    fill: 'fill-pink-500',
    cells: [
      [0, 0],
      [3, 0],
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
      [0, 3],
      [3, 3]
    ]
  }
]

const CARDS = [
  { x: 52, y: 66, rotate: -8, tint: 8 },
  { x: 86, y: 44, rotate: 4, tint: 6 },
  { x: 106, y: 72, rotate: -3, tint: 3 }
] as const

/** What each window holds, in card coordinates: a picture, a file of code, and a page being written. */
function CardContent({
  index,
  x,
  y,
  quiet,
  strong,
  lineClass
}: {
  index: number
  x: number
  y: number
  quiet: string
  strong: string
  /** Animates a line as if it were being written. */
  lineClass: string
}) {
  if (index === 0) {
    return (
      <>
        <rect x={x + 6} y={y + 18} width="28" height="36" rx="3" stroke={quiet} strokeWidth="1.5" />
        <circle cx={x + 26} cy={y + 26} r="3" className="fill-amber-400" />
        <path d={`m${x + 8} ${y + 50} 8-10 6 6 4-4 6 8`} stroke={quiet} strokeWidth="1.5" strokeLinejoin="round" />
      </>
    )
  }
  if (index === 1) {
    return (
      <g stroke={quiet} strokeWidth="2" strokeLinecap="round">
        <path d={`M${x + 8} ${y + 20}h14M${x + 26} ${y + 20}h20`} />
        <path d={`M${x + 14} ${y + 26}h24`} />
      </g>
    )
  }
  return (
    <g strokeLinecap="round">
      {PAGE_LINES.map((line, row) => (
        <path
          key={line.dy}
          className={lineClass}
          style={{ animationDelay: `${row * 0.3}s` }}
          pathLength={1}
          d={`M${x + 10} ${y + line.dy}h${line.width}`}
          stroke={line.heading ? strong : quiet}
          strokeWidth={line.heading ? 3 : 2}
        />
      ))}
    </g>
  )
}

const PAGE_LINES: readonly { dy: number; width: number; heading?: boolean }[] = [
  { dy: 22, width: 34, heading: true },
  { dy: 32, width: 64 },
  { dy: 39, width: 56 },
  { dy: 46, width: 60 },
  { dy: 53, width: 36 }
]

/** Empty windows waiting for their first output, with pixel sprites drifting around them. */
function OutputsIllustration() {
  const id = useId().replace(/:/g, '')
  const edge = 'color-mix(in oklab, var(--foreground) 12%, transparent)'
  const dot = 'color-mix(in oklab, var(--muted-foreground) 45%, transparent)'
  const quiet = 'color-mix(in oklab, var(--muted-foreground) 35%, transparent)'
  const strong = 'color-mix(in oklab, var(--muted-foreground) 60%, transparent)'

  return (
    <svg width="220" height="150" viewBox="0 0 240 164" fill="none" aria-hidden="true">
      <style>{`
        .${id}-sprite { transform-box: fill-box; transform-origin: center; animation: ${id}-float 3.6s ease-in-out infinite }
        .${id}-front { animation: ${id}-drift 6s ease-in-out infinite }
        @keyframes ${id}-float {
          0%, 100% { transform: translateY(0) rotate(0deg) }
          50% { transform: translateY(-7px) rotate(10deg) }
        }
        .${id}-line { stroke-dasharray: 1; animation: ${id}-write 5s ease-out infinite }
        @keyframes ${id}-drift { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        @keyframes ${id}-write { 0% { stroke-dashoffset: 1 } 30%, 88% { stroke-dashoffset: 0 } 100% { stroke-dashoffset: 1 } }
        @media (prefers-reduced-motion: reduce) { .${id}-sprite, .${id}-front, .${id}-line { animation: none } }
      `}</style>

      {CARDS.map((card, index) => (
        <g key={index} className={index === CARDS.length - 1 ? `${id}-front` : undefined}>
          <g transform={`rotate(${card.rotate} ${card.x + 42} ${card.y + 31})`}>
            <rect
              x={card.x}
              y={card.y}
              width="84"
              height="62"
              rx="6"
              fill={`color-mix(in oklab, var(--muted-foreground) ${card.tint}%, var(--card))`}
              stroke={edge}
            />
            <path d={`M${card.x} ${card.y + 12}h84`} stroke={edge} />
            {[8, 14, 20].map((dx) => (
              <circle key={dx} cx={card.x + dx} cy={card.y + 6} r="1.6" fill={dot} />
            ))}
            <CardContent index={index} x={card.x} y={card.y} quiet={quiet} strong={strong} lineClass={`${id}-line`} />
          </g>
        </g>
      ))}

      {SPRITES.map((sprite, index) => (
        <g key={sprite.fill} transform={`rotate(${sprite.tilt} ${sprite.x + 8} ${sprite.y + 8})`}>
          <g className={cn(`${id}-sprite`, sprite.fill)} style={{ animationDelay: `${index * -0.7}s` }}>
            {sprite.cells.map(([cx, cy]) => (
              <rect key={`${cx}-${cy}`} x={sprite.x + cx * 4} y={sprite.y + cy * 4} width="4" height="4" />
            ))}
          </g>
        </g>
      ))}
    </svg>
  )
}

function OutputsEmpty({ hint }: { hint: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center px-6 pt-8 pb-12 text-center">
      <OutputsIllustration />
      <span className="mt-4 text-foreground text-sm">{t('chat.profile_pane.outputs.empty.title')}</span>
      <span className="mt-1.5 max-w-60 text-muted-foreground text-xs leading-relaxed">{hint}</span>
    </div>
  )
}
