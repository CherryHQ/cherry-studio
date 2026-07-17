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
import type { TopicDisplayMode, TopicSessionSortBy } from '@shared/data/preference/preferenceTypes'
import { ArrowUpDown, Bot, ChevronsDownUp, ChevronsUpDown, History, LayoutList, ListFilter } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceList } from './ResourceList'

const TOPIC_DISPLAY_OPTIONS: TopicDisplayMode[] = ['time', 'assistant']
const TOPIC_DISPLAY_LABEL_KEYS: Record<TopicDisplayMode, string> = {
  assistant: 'chat.topics.display.assistant',
  time: 'chat.topics.display.time'
}
const TOPIC_SORT_OPTIONS: TopicSessionSortBy[] = ['lastActivityAt', 'createdAt', 'orderKey']
const TOPIC_SORT_LABEL_KEYS: Record<TopicSessionSortBy, string> = {
  createdAt: 'common.sort.created_at',
  lastActivityAt: 'common.sort.updated_at',
  orderKey: 'common.sort.manual_order'
}
const ACTIVE_MENU_ITEM_CLASS = 'data-[active=true]:bg-accent data-[active=true]:text-accent-foreground'

type TopicListOptionsMenuProps = {
  historyRecordsActive?: boolean
  manageAssistantsActive?: boolean
  mode: TopicDisplayMode
  onChange: (mode: TopicDisplayMode) => void
  onManageAssistants?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSortByChange: (sortBy: TopicSessionSortBy) => void
  sectionId?: string
  sortBy: TopicSessionSortBy
}

export function TopicListOptionsMenu({
  historyRecordsActive,
  manageAssistantsActive,
  mode,
  onChange,
  onManageAssistants,
  onOpenHistoryRecords,
  onSortByChange,
  sectionId,
  sortBy
}: TopicListOptionsMenuProps) {
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
            <span>{t('chat.topics.display.title')}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {TOPIC_DISPLAY_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option}
                role="menuitemradio"
                checked={mode === option}
                onCheckedChange={() => runAfterMenuClose(() => onChange(option))}>
                <span>{t(TOPIC_DISPLAY_LABEL_KEYS[option])}</span>
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
            {TOPIC_SORT_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option}
                role="menuitemradio"
                checked={sortBy === option}
                onCheckedChange={() => runAfterMenuClose(() => onSortByChange(option))}>
                <span>{t(TOPIC_SORT_LABEL_KEYS[option])}</span>
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
              expandLabel={t('chat.topics.group.expand_all')}
              collapseLabel={t('chat.topics.group.collapse_all')}
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
        {onManageAssistants && <DropdownMenuSeparator />}
        {onManageAssistants && (
          <DropdownMenuItem
            className={ACTIVE_MENU_ITEM_CLASS}
            data-active={manageAssistantsActive || undefined}
            onSelect={() => runAfterMenuClose(() => void onManageAssistants())}>
            <Bot size={16} />
            <span>{t('assistants.presets.manage.title')}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
