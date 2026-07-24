import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@cherrystudio/ui'
import type { AgentSessionDisplayMode, TopicSessionSortBy } from '@shared/data/preference/preferenceTypes'
import { ArrowUpDown, Bot, ChevronsDownUp, ChevronsUpDown, History, LayoutList, ListFilter } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceList } from './ResourceList'

const SESSION_DISPLAY_OPTIONS: AgentSessionDisplayMode[] = ['time', 'workdir', 'agent']
export const SESSION_DISPLAY_LABEL_KEYS: Record<AgentSessionDisplayMode, string> = {
  agent: 'agent.session.display.agent',
  time: 'agent.session.display.time',
  workdir: 'agent.session.display.workdir'
}
const SESSION_SORT_OPTIONS: TopicSessionSortBy[] = ['lastActivityAt', 'createdAt', 'orderKey']
const SESSION_SORT_LABEL_KEYS: Record<TopicSessionSortBy, string> = {
  createdAt: 'common.sort.created_at',
  lastActivityAt: 'common.sort.last_active',
  orderKey: 'common.sort.manual_order'
}
const ACTIVE_MENU_ITEM_CLASS = 'data-[active=true]:bg-accent data-[active=true]:text-accent-foreground'

type SessionListOptionsMenuProps = {
  historyRecordsActive?: boolean
  manageAgentsActive?: boolean
  mode: AgentSessionDisplayMode
  onChange: (mode: AgentSessionDisplayMode) => void
  onManageAgents?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSortByChange: (sortBy: TopicSessionSortBy) => void
  sectionIds?: readonly string[]
  sortBy: TopicSessionSortBy
}

export function SessionListOptionsMenu({
  historyRecordsActive,
  manageAgentsActive,
  mode,
  onChange,
  onManageAgents,
  onOpenHistoryRecords,
  onSortByChange,
  sectionIds,
  sortBy
}: SessionListOptionsMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const runAfterMenuClose = (action: () => void) => {
    setOpen(false)
    window.setTimeout(action, 0)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <ResourceList.HeaderActionButton type="button" aria-label={t('common.list_options')}>
          <ListFilter className="block" />
        </ResourceList.HeaderActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <LayoutList />
            <span>{t('agent.session.display.title')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {SESSION_DISPLAY_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option}
                role="menuitemradio"
                checked={mode === option}
                onCheckedChange={() => runAfterMenuClose(() => onChange(option))}>
                <span>{t(SESSION_DISPLAY_LABEL_KEYS[option])}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowUpDown />
            <span>{t('common.sort.title')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {SESSION_SORT_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option}
                role="menuitemradio"
                checked={sortBy === option}
                onCheckedChange={() => runAfterMenuClose(() => onSortByChange(option))}>
                <span>{t(SESSION_SORT_LABEL_KEYS[option])}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {sectionIds && sectionIds.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <ResourceList.SectionToggleDropdownMenuItem
              expandIcon={<ChevronsUpDown size={16} />}
              collapseIcon={<ChevronsDownUp size={16} />}
              sectionIds={sectionIds}
              expandLabel={t('agent.session.group.expand_all')}
              collapseLabel={t('agent.session.group.collapse_all')}
              onSelect={() => {
                setOpen(false)
              }}
            />
          </>
        )}
        {onOpenHistoryRecords && <DropdownMenuSeparator />}
        {onOpenHistoryRecords && (
          <DropdownMenuItem
            className={ACTIVE_MENU_ITEM_CLASS}
            data-active={historyRecordsActive || undefined}
            onSelect={() => runAfterMenuClose(onOpenHistoryRecords)}>
            <History size={16} />
            <span>{t('history.records.shortTitle')}</span>
          </DropdownMenuItem>
        )}
        {onManageAgents && <DropdownMenuSeparator />}
        {onManageAgents && (
          <DropdownMenuItem
            className={ACTIVE_MENU_ITEM_CLASS}
            data-active={manageAgentsActive || undefined}
            onSelect={() => runAfterMenuClose(() => void onManageAgents())}>
            <Bot size={16} />
            <span>{t('agent.manage.title')}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
