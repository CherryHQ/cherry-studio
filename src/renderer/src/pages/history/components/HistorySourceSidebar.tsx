import { Input } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import type { HistoryRecordsMode } from '@renderer/pages/history/HistoryRecordsPage'
import { cn } from '@renderer/utils'
import { Circle, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type HistorySourceStatus = 'all' | 'running' | 'completed' | 'failed'

interface HistorySourceSidebarProps {
  mode: HistoryRecordsMode
  selectedSourceId: string
  selectedStatus?: HistorySourceStatus
  sources: HistorySourceItem[]
  onSourceSelect: (sourceId: string) => void
  onStatusSelect?: (status: HistorySourceStatus) => void
  statusItems?: HistoryStatusItem[]
}

export interface HistorySourceItem {
  id: string
  label: string
  count: number
  icon?: ReactNode
}

export interface HistoryStatusItem {
  id: HistorySourceStatus
  label: string
  count: number
  dotClassName?: string
}

const HistorySourceSidebar = ({
  mode,
  selectedSourceId,
  selectedStatus,
  sources,
  onSourceSelect,
  onStatusSelect,
  statusItems = []
}: HistorySourceSidebarProps) => {
  const { t } = useTranslation()
  const [assistantSearchText, setAssistantSearchText] = useState('')

  const visibleAssistantSources = useMemo(() => {
    const keywords = assistantSearchText.trim().toLowerCase()
    if (!keywords) return sources

    return sources.filter((source) => source.id === 'all' || source.label.toLowerCase().includes(keywords))
  }, [assistantSearchText, sources])

  return (
    <aside className="flex w-[284px] shrink-0 flex-col bg-card [border-right:0.5px_solid_var(--color-border-subtle)]">
      <Scrollbar className="min-h-0 flex-1 px-3 py-3.5">
        {mode === 'agent' && statusItems.length > 0 && selectedStatus && onStatusSelect && (
          <SidebarSection title={t('history.records.sidebar.status', '状态')}>
            <div className="space-y-1">
              {statusItems.map((item) => (
                <SidebarRow
                  key={item.id}
                  active={selectedStatus === item.id}
                  label={item.label}
                  count={item.count}
                  icon={
                    item.id === 'all' ? undefined : (
                      <Circle className={cn('fill-current', item.dotClassName)} size={8} />
                    )
                  }
                  onClick={() => onStatusSelect(item.id)}
                />
              ))}
            </div>
          </SidebarSection>
        )}

        <SidebarSection title={mode === 'assistant' ? t('common.assistant', '助手') : t('common.agent', '智能体')}>
          {mode === 'assistant' && (
            <div className="relative mb-3">
              <Search
                size={15}
                className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 text-foreground-muted"
              />
              <Input
                value={assistantSearchText}
                className="h-8 rounded-md border-border-subtle bg-card pl-8 text-xs shadow-none"
                placeholder={t('history.records.sidebar.searchAssistant', '搜索助手...')}
                aria-label={t('history.records.sidebar.searchAssistant', '搜索助手...')}
                onChange={(event) => setAssistantSearchText(event.target.value)}
              />
            </div>
          )}

          <div className="space-y-1">
            {(mode === 'assistant' ? visibleAssistantSources : sources).map((item) => (
              <SidebarRow
                key={item.id}
                active={selectedSourceId === item.id}
                label={item.label}
                count={item.count}
                icon={item.icon}
                onClick={() => onSourceSelect(item.id)}
              />
            ))}
          </div>
        </SidebarSection>
      </Scrollbar>
    </aside>
  )
}

interface SidebarSectionProps {
  title: string
  children: ReactNode
}

const SidebarSection = ({ title, children }: SidebarSectionProps) => (
  <section className="mb-5 last:mb-0">
    <h3 className="mb-2 px-2 font-medium text-foreground-muted text-xs leading-4">{title}</h3>
    {children}
  </section>
)

interface SidebarRowProps {
  active: boolean
  icon?: ReactNode
  label: string
  count: number
  onClick: () => void
}

const SidebarRow = ({ active, icon, label, count, onClick }: SidebarRowProps) => (
  <button
    type="button"
    className={cn(
      'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs leading-4 transition-colors',
      active
        ? 'bg-muted/50 font-semibold text-foreground'
        : 'font-medium text-foreground-secondary hover:bg-muted/40 hover:text-foreground'
    )}
    onClick={onClick}>
    {icon ? (
      <span className="flex size-4.5 shrink-0 items-center justify-center text-foreground-muted">{icon}</span>
    ) : null}
    <span className="min-w-0 flex-1 truncate">{label}</span>
    <span className="shrink-0 font-medium text-foreground-muted tabular-nums">{count}</span>
  </button>
)

export default HistorySourceSidebar
