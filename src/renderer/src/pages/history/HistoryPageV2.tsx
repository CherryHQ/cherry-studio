import { Button } from '@cherrystudio/ui'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useAllTopics } from '@renderer/hooks/useTopicDataApi'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import { Bot, History, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import HistoryQueryForm from './components/HistoryQueryForm'
import HistoryResultList from './components/HistoryResultList'
import HistorySourceSidebar, {
  type HistorySourceItem,
  type HistorySourceStatus
} from './components/HistorySourceSidebar'

export type HistoryPageV2Mode = 'assistant' | 'agent'

const ALL_SOURCE_ID = 'all'
const DEFAULT_ASSISTANT_SOURCE_ID = '__default_assistant__'

interface HistoryPageV2Props {
  mode: HistoryPageV2Mode
  open: boolean
  onClose: () => void
}

const HistoryPageV2 = ({ mode, open, onClose }: HistoryPageV2Props) => {
  if (!open) return null

  const portalRootId = mode === 'assistant' ? 'home-page' : 'agent-page'
  const portalRoot = document.getElementById(portalRootId)

  if (!portalRoot) return null

  return createPortal(<HistoryPageV2Content mode={mode} onClose={onClose} />, portalRoot)
}

interface HistoryPageV2ContentProps {
  mode: HistoryPageV2Mode
  onClose: () => void
}

const HistoryPageV2Content = ({ mode, onClose }: HistoryPageV2ContentProps) => {
  const { t } = useTranslation()
  const [selectedSourceId, setSelectedSourceId] = useState(ALL_SOURCE_ID)
  const [selectedStatus, setSelectedStatus] = useState<HistorySourceStatus>('all')
  const [searchText, setSearchText] = useState('')

  const { topics: rawTopics, isLoading: isTopicsLoading } = useAllTopics({ loadAll: true })
  const { assistants } = useAssistants()
  const topics = rawTopics

  const assistantById = useMemo(() => new Map(assistants.map((assistant) => [assistant.id, assistant])), [assistants])
  const defaultAssistantLabel = t('chat.default.name', '默认助手')

  const assistantSources = useMemo(
    () => buildAssistantSources(topics, assistantById, defaultAssistantLabel, t),
    [assistantById, defaultAssistantLabel, t, topics]
  )

  const filteredTopics = useMemo(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return topics

    return topics.filter((topic) => getTopicSourceId(topic) === selectedSourceId)
  }, [selectedSourceId, topics])

  const searchedTopics = useMemo(() => {
    const keywords = searchText.trim().toLowerCase()
    if (!keywords) return filteredTopics

    return filteredTopics.filter((topic) => {
      const topicName = topic.name || t('chat.default.topic.name', '新话题')
      return topicName.toLowerCase().includes(keywords)
    })
  }, [filteredTopics, searchText, t])

  useEffect(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return
    if (assistantSources.some((source) => source.id === selectedSourceId)) return

    setSelectedSourceId(ALL_SOURCE_ID)
  }, [assistantSources, selectedSourceId])

  const visibleTopics = mode === 'assistant' ? searchedTopics : []
  const subtitle =
    mode === 'assistant'
      ? t('history.v2.assistantSubtitle', '{{count}} 个话题', { count: topics.length })
      : t('history.v2.agentSubtitlePlaceholder', '话题与运行状态待接入')

  return (
    <div className="absolute inset-0 z-[1000] flex bg-background [-webkit-app-region:none]">
      <section
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground"
        aria-label={t('history.v2.overlayLabel', '话题历史记录')}>
        <header className="flex h-[52px] shrink-0 items-center justify-between bg-background px-5 [border-bottom:0.5px_solid_var(--color-border-subtle)]">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-background text-foreground-secondary">
              <History size={16} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-base text-foreground leading-5">
                {t('history.v2.title', '话题历史记录')}
              </h2>
              <p className="mt-0.5 truncate text-foreground-muted text-xs leading-4">{subtitle}</p>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 min-h-7 rounded-md text-foreground-muted shadow-none hover:bg-accent hover:text-foreground"
            aria-label={t('common.close', '关闭')}
            onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <HistorySourceSidebar
            mode={mode}
            assistantSources={assistantSources}
            selectedSourceId={selectedSourceId}
            selectedStatus={selectedStatus}
            onSourceSelect={setSelectedSourceId}
            onStatusSelect={setSelectedStatus}
          />

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <HistoryQueryForm
              resultCount={visibleTopics.length}
              searchText={searchText}
              onSearchTextChange={setSearchText}
            />
            <HistoryResultList
              mode={mode}
              topics={visibleTopics}
              assistantById={assistantById}
              defaultAssistantLabel={defaultAssistantLabel}
              isLoading={mode === 'assistant' && isTopicsLoading}
            />
          </main>
        </div>
      </section>
    </div>
  )
}

function getTopicSourceId(topic: Topic) {
  return topic.assistantId ?? DEFAULT_ASSISTANT_SOURCE_ID
}

function buildAssistantSources(
  topics: readonly Topic[],
  assistantById: ReadonlyMap<string, Assistant>,
  defaultAssistantLabel: string,
  t: ReturnType<typeof useTranslation>['t']
): HistorySourceItem[] {
  const counts = new Map<string, number>()

  for (const topic of topics) {
    const sourceId = getTopicSourceId(topic)
    counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1)
  }

  return [
    {
      id: ALL_SOURCE_ID,
      label: t('common.all', '全部'),
      count: topics.length,
      icon: <Bot size={15} />
    },
    ...Array.from(counts.entries()).map(([sourceId, count]) => {
      const assistant = sourceId === DEFAULT_ASSISTANT_SOURCE_ID ? undefined : assistantById.get(sourceId)

      return {
        id: sourceId,
        label:
          sourceId === DEFAULT_ASSISTANT_SOURCE_ID
            ? defaultAssistantLabel
            : (assistant?.name ?? t('history.v2.sidebar.unknownAssistant', '未知助手')),
        count,
        icon: assistant?.emoji ? <span className="text-sm leading-none">{assistant.emoji}</span> : <Bot size={15} />
      }
    })
  ]
}

export default HistoryPageV2
