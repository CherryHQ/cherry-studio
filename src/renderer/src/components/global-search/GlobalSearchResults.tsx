import EmojiIcon from '@renderer/components/EmojiIcon'
import HighlightText from '@renderer/components/HighlightText'
import { cn } from '@renderer/utils'
import { formatRelativeTime } from '@renderer/utils/time'
import type { GlobalSearchItem } from '@shared/data/api/schemas/globalSearch'
import type { SessionSearchMessageResult } from '@shared/data/api/schemas/sessions'
import { Bot, ChevronDown, Clock3, FileSearch, MessageSquare, MousePointerClick, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type {
  GlobalMessageSearchPanelGroup,
  GlobalMessageSearchPanelItem,
  GlobalSearchGroupId,
  GlobalSearchPanelGroup,
  GlobalSearchPanelItem
} from './globalSearchGroups'

const RESULT_ICONS: Record<GlobalSearchItem['type'], typeof MessageSquare> = {
  topic: MessageSquare,
  session: MousePointerClick,
  assistant: Sparkles,
  agent: Bot,
  'knowledge-base': FileSearch
}

const RECENT_ICONS = {
  route: Clock3,
  topic: MessageSquare,
  session: MousePointerClick
}

const GROUP_LABEL_KEYS: Record<GlobalSearchGroupId, string> = {
  recent: 'globalSearch.groups.recent',
  topic: 'globalSearch.groups.topic',
  session: 'globalSearch.groups.session',
  assistant: 'globalSearch.groups.assistant',
  agent: 'globalSearch.groups.agent',
  'knowledge-base': 'globalSearch.groups.knowledge-base'
}

const RESULT_TYPE_LABEL_KEYS: Record<GlobalSearchItem['type'], string> = {
  topic: 'globalSearch.resultTypes.topic',
  session: 'globalSearch.resultTypes.session',
  assistant: 'globalSearch.resultTypes.assistant',
  agent: 'globalSearch.resultTypes.agent',
  'knowledge-base': 'common.knowledge_base'
}

const MESSAGE_ROLE_LABEL_KEYS: Record<NonNullable<SessionSearchMessageResult['role']>, string> = {
  assistant: 'globalSearch.messageSearch.roles.assistant',
  system: 'globalSearch.messageSearch.roles.system',
  tool: 'globalSearch.messageSearch.roles.tool',
  user: 'globalSearch.messageSearch.roles.user'
}

function getGroupLabelKey(groupId: GlobalSearchGroupId) {
  return GROUP_LABEL_KEYS[groupId]
}

function getResultTypeLabelKey(type: GlobalSearchItem['type']) {
  return RESULT_TYPE_LABEL_KEYS[type]
}

function getMessageRoleLabelKey(role: NonNullable<SessionSearchMessageResult['role']>) {
  return MESSAGE_ROLE_LABEL_KEYS[role]
}

function getMessageActorLabel(
  result: GlobalMessageSearchPanelItem & { kind: 'message' },
  t: (key: string) => string,
  userName?: string
) {
  if (!result.result.role || result.result.role === 'user') {
    return userName?.trim() || t(getMessageRoleLabelKey('user'))
  }

  return t(getMessageRoleLabelKey(result.result.role))
}

function getResultSubtitle(result: GlobalSearchItem, t: (key: string) => string) {
  if (result.type === 'topic' || result.type === 'session') {
    return result.subtitle
  }

  return result.subtitle ?? t(getResultTypeLabelKey(result.type))
}

export function GlobalSearchGroupHeader({ group }: { group: GlobalSearchPanelGroup }) {
  const { t } = useTranslation()

  return (
    <div className="flex h-7 items-center gap-1.5 px-5 pt-1 font-medium text-muted-foreground text-sm">
      <span>{t(getGroupLabelKey(group.id))}</span>
      <span>·</span>
      <span>{group.items.length}</span>
    </div>
  )
}

export function GlobalSearchRow({
  item,
  active,
  language,
  query,
  onMouseEnter,
  onOpen
}: {
  item: GlobalSearchPanelItem
  active: boolean
  language: string
  query: string
  onMouseEnter: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const isRecent = item.kind === 'recent'
  const title = isRecent ? item.recent.title : item.result.title
  const subtitle = isRecent ? undefined : getResultSubtitle(item.result, t)
  const Icon = isRecent ? RECENT_ICONS[item.recent.kind] : RESULT_ICONS[item.result.type]
  const emoji =
    !isRecent && ['assistant', 'agent', 'knowledge-base'].includes(item.result.type) ? item.result.emoji : undefined
  const updatedAt = isRecent ? undefined : item.result.updatedAt
  const updatedAtLabel = formatRelativeTime(updatedAt, language)

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onClick={onOpen}
      className={cn(
        'mx-5 flex h-[48px] w-[calc(100%-2.5rem)] items-center gap-2.5 rounded-[12px] px-3 text-left transition-colors',
        active ? 'bg-muted/60 text-accent-foreground' : 'hover:bg-muted/40'
      )}>
      {emoji ? (
        <EmojiIcon emoji={emoji} size={32} fontSize={15} className="mr-0 bg-muted/50" />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground text-sm leading-5">
          <HighlightText text={title || t('common.unnamed')} keyword={query} />
        </span>
        {subtitle && (
          <span className="block truncate text-muted-foreground text-xs leading-4">
            <HighlightText text={subtitle} keyword={query} />
          </span>
        )}
      </span>
      {updatedAtLabel && (
        <span className="ml-2 shrink-0 text-muted-foreground text-xs leading-4" title={updatedAt}>
          {updatedAtLabel}
        </span>
      )}
    </button>
  )
}

export function GlobalMessageSearchGroupHeader({ group }: { group: GlobalMessageSearchPanelGroup }) {
  const { t } = useTranslation()
  const Icon = group.sourceType === 'topic' ? MessageSquare : MousePointerClick
  const sourceLabelKey =
    group.sourceType === 'topic'
      ? 'globalSearch.messageSearch.sources.topic'
      : 'globalSearch.messageSearch.sources.session'

  return (
    <div className="flex h-8 items-center gap-2 px-5 text-sm">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/50">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
        {group.title || t('common.unnamed')}
      </span>
      <span className="ml-2 flex h-5 shrink-0 items-center gap-1 rounded-[6px] bg-muted/40 px-1.5 font-medium text-muted-foreground text-xs">
        <span>{t(sourceLabelKey)}</span>
        <span>·</span>
        <span>{group.total}</span>
      </span>
    </div>
  )
}

export function GlobalMessageSearchRow({
  active,
  item,
  language,
  query,
  userName,
  onMouseEnter,
  onOpen
}: {
  active: boolean
  item: GlobalMessageSearchPanelItem
  language: string
  query: string
  userName?: string
  onMouseEnter: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()

  if (item.kind === 'more') {
    return (
      <div className="h-9 pt-1">
        <button
          type="button"
          role="option"
          aria-selected={active}
          onMouseEnter={onMouseEnter}
          onClick={onOpen}
          className={cn(
            'mx-5 flex h-8 w-[calc(100%-2.5rem)] items-center gap-1 rounded-lg py-0 pr-3 pl-8 text-left font-medium text-xs transition-colors',
            active
              ? 'bg-muted/60 text-accent-foreground'
              : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
          )}>
          <span>{t('globalSearch.messageSearch.more', { count: item.remainingCount })}</span>
          <ChevronDown className="size-4" />
        </button>
      </div>
    )
  }

  const updatedAtLabel = formatRelativeTime(item.result.createdAt, language)
  const actorLabel = getMessageActorLabel(item, t, userName)

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onClick={onOpen}
      className={cn(
        'mx-5 flex h-11 w-[calc(100%-2.5rem)] items-center gap-2 rounded-[10px] pr-3 pl-8 text-left transition-colors',
        active ? 'bg-muted/60 text-accent-foreground' : 'hover:bg-muted/40'
      )}>
      <span className="min-w-0 flex-1 truncate text-foreground/90 text-sm leading-5">
        <span className="font-medium text-muted-foreground">{actorLabel}</span>
        <span className="text-muted-foreground">: </span>
        <HighlightText text={item.result.snippet} keyword={query} />
      </span>
      {updatedAtLabel && (
        <span
          className="shrink-0 whitespace-nowrap text-muted-foreground text-xs leading-4"
          title={item.result.createdAt}>
          {updatedAtLabel}
        </span>
      )}
    </button>
  )
}

export function GlobalSearchRecentHint({ label, offset }: { label: string; offset: number }) {
  return (
    <div className="pointer-events-none absolute right-5 left-5 text-muted-foreground text-sm" style={{ top: offset }}>
      {label}
    </div>
  )
}

export function GlobalSearchState({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">{label}</div>
}
