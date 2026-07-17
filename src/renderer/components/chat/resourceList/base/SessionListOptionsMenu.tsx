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
import { type ReactNode, useState } from 'react'
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
  lastActivityAt: 'common.sort.updated_at',
  orderKey: 'common.sort.manual_order'
}
const ACTIVE_MENU_ITEM_CLASS = 'data-[active=true]:bg-accent data-[active=true]:text-accent-foreground'

type SessionListOptionsMenuProps = {
  historyRecordsActive?: boolean
  manageAgentsActive?: boolean
  manageSkillsActive?: boolean
  manageSkillsIcon?: ReactNode
  mode: AgentSessionDisplayMode
  onChange: (mode: AgentSessionDisplayMode) => void
  onManageAgents?: () => void | Promise<void>
  onManageSkills?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSortByChange: (sortBy: TopicSessionSortBy) => void
  sectionId?: string
  sortBy: TopicSessionSortBy
}

export function SessionListOptionsMenu({
  historyRecordsActive,
  manageAgentsActive,
  manageSkillsActive,
  manageSkillsIcon,
  mode,
  onChange,
  onManageAgents,
  onManageSkills,
  onOpenHistoryRecords,
  onSortByChange,
  sectionId,
  sortBy
}: SessionListOptionsMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const hasManagementItems = !!(onManageAgents || onManageSkills)
  const runAfterMenuClose = (action: () => void) => {
    setOpen(false)
    window.setTimeout(action, 0)
  }
  const manageSkillsMenuIcon = manageSkillsIcon ? (
    <span className="inline-flex size-4 items-center justify-center [&_svg]:size-4">{manageSkillsIcon}</span>
  ) : undefined

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
        {sectionId && (
          <>
            <DropdownMenuSeparator />
            <ResourceList.SectionToggleDropdownMenuItem
              expandIcon={<ChevronsUpDown size={16} />}
              collapseIcon={<ChevronsDownUp size={16} />}
              sectionId={sectionId}
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
        {hasManagementItems && <DropdownMenuSeparator />}
        {onManageAgents && (
          <DropdownMenuItem
            className={ACTIVE_MENU_ITEM_CLASS}
            data-active={manageAgentsActive || undefined}
            onSelect={() => runAfterMenuClose(() => void onManageAgents())}>
            <Bot size={16} />
            <span>{t('agent.manage.title')}</span>
          </DropdownMenuItem>
        )}
        {onManageSkills && (
          <DropdownMenuItem
            className={ACTIVE_MENU_ITEM_CLASS}
            data-active={manageSkillsActive || undefined}
            onSelect={() => runAfterMenuClose(() => void onManageSkills())}>
            {manageSkillsMenuIcon}
            <span>{t('agent.skill.manage.title')}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
