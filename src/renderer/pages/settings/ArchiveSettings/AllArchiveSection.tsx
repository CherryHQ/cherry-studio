import { ListTodo, MessageSquare } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import { useDataChange, useInfiniteFlatItems, useInfiniteQuery } from '@renderer/data/hooks/useDataApi'
import { formatErrorMessage } from '@renderer/utils/error'
import type { ArchiveDomain } from '@shared/data/api/schemas/archives'

import type { ArchiveBatchOutcome, ArchiveItem } from './archive'
import type { ArchiveDomainSectionProps } from './ArchiveDomainSections'
import ArchiveSection from './ArchiveSection'
import {
  useAgentArchiveActions,
  useAssistantArchiveActions,
  useFileArchiveActions,
  usePaintingArchiveActions,
  useSessionArchiveActions,
  useTopicArchiveActions
} from './useArchiveActions'

const logger = loggerService.withContext('AllArchiveSection')

const DOMAIN_PRESENTATION = {
  topics: { icon: MessageSquare, labelKey: 'settings.data.trash.domain.topics' },
  assistants: { icon: SIDEBAR_ICON_COMPONENTS.assistants, labelKey: 'settings.data.trash.domain.assistants' },
  agents: { icon: SIDEBAR_ICON_COMPONENTS.agents, labelKey: 'settings.data.trash.domain.agents' },
  sessions: { icon: ListTodo, labelKey: 'settings.data.trash.domain.sessions' },
  paintings: { icon: SIDEBAR_ICON_COMPONENTS.paintings, labelKey: 'settings.data.trash.domain.paintings' },
  files: { icon: SIDEBAR_ICON_COMPONENTS.files, labelKey: 'settings.data.trash.domain.files' }
} as const

export default function AllArchiveSection(props: ArchiveDomainSectionProps) {
  const { t } = useTranslation()
  const { pages, isLoading, isRefreshing, error, hasNext, loadNext, refresh } = useInfiniteQuery('/archives', {
    limit: 50
  })
  const entries = useInfiniteFlatItems(pages)
  const pendingActions = useRef(0)
  const refreshArchive = async () => {
    if (pendingActions.current > 0) return
    try {
      await refresh()
    } catch (error) {
      logger.warn('Failed to refresh archive', error as Error)
    }
  }
  useDataChange(['/topics', '/assistants', '/agents', '/agent-sessions', '/paintings', '/files/entries'], () => {
    void refreshArchive()
  })

  const actions = {
    topics: useTopicArchiveActions(refreshArchive),
    assistants: useAssistantArchiveActions(refreshArchive),
    agents: useAgentArchiveActions(refreshArchive),
    sessions: useSessionArchiveActions(refreshArchive),
    paintings: usePaintingArchiveActions(refreshArchive),
    files: useFileArchiveActions()
  }
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
  const items = useMemo(
    () =>
      entries.map((entry) => {
        const { icon: Icon, labelKey } = DOMAIN_PRESENTATION[entry.domain]
        return { ...entry, categoryLabel: t(labelKey), icon: <Icon className="size-4.5" /> }
      }),
    [entries, t]
  )
  const pendingDomain = (Object.keys(actions) as ArchiveDomain[]).find(
    (domain) => actions[domain].pendingRestoreId !== null
  )
  const pendingRestoreId = pendingDomain ? `${pendingDomain}:${actions[pendingDomain].pendingRestoreId}` : null

  const withArchiveRefresh = async <T,>(run: () => Promise<T>): Promise<T> => {
    pendingActions.current += 1
    try {
      return await run()
    } finally {
      pendingActions.current -= 1
      await refreshArchive()
    }
  }

  const runBatch = async (
    targets: ArchiveItem[],
    action: 'onRestoreMany' | 'onPermanentDeleteMany'
  ): Promise<ArchiveBatchOutcome> =>
    withArchiveRefresh(async () => {
      const outcome: ArchiveBatchOutcome = { succeeded: [], failed: [] }
      for (const domain of Object.keys(actions) as ArchiveDomain[]) {
        const domainItems = targets.filter((item) => entriesById.get(item.id)?.domain === domain)
        if (domainItems.length === 0) continue
        try {
          const result = await actions[domain][action](
            domainItems.map((item) => ({ ...item, id: entriesById.get(item.id)!.entityId }))
          )
          outcome.succeeded.push(...result.succeeded.map((id) => `${domain}:${id}`))
          outcome.failed.push(...result.failed.map((failure) => ({ ...failure, id: `${domain}:${failure.id}` })))
        } catch (error) {
          outcome.failed.push(...domainItems.map(({ id }) => ({ id, error: formatErrorMessage(error) })))
        }
      }
      return outcome
    })

  return (
    <ArchiveSection
      {...props}
      items={items}
      isLoading={isLoading}
      error={error}
      onRetry={refresh}
      pagination={{ kind: 'cursor', hasMore: hasNext, isLoadingMore: isRefreshing, onLoadMore: loadNext }}
      pendingRestoreId={pendingRestoreId}
      onRestore={(item) =>
        withArchiveRefresh(async () => {
          const entry = entriesById.get(item.id)!
          await actions[entry.domain].onRestore({ ...item, id: entry.entityId })
        })
      }
      onRestoreMany={(items) => runBatch(items, 'onRestoreMany')}
      onPermanentDelete={(item) =>
        withArchiveRefresh(async () => {
          const entry = entriesById.get(item.id)!
          const result = await actions[entry.domain].onPermanentDelete({ ...item, id: entry.entityId })
          return {
            succeeded: result.succeeded.map((id) => `${entry.domain}:${id}`),
            failed: result.failed.map((failure) => ({ ...failure, id: `${entry.domain}:${failure.id}` }))
          }
        })
      }
      onPermanentDeleteMany={(items) => runBatch(items, 'onPermanentDeleteMany')}
      onRequestDelete={(request) => {
        const fileEntryIds = request.items.flatMap((item) => {
          const entry = entriesById.get(item.id)!
          return entry.domain === 'files' ? [entry.entityId] : []
        })
        props.onRequestDelete({ ...request, fileEntryIds: fileEntryIds.length > 0 ? fileEntryIds : undefined })
      }}
    />
  )
}
