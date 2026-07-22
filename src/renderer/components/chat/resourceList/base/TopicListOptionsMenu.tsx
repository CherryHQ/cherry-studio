import { MenuDivider, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import type { TopicDisplayMode } from '@shared/data/preference/preferenceTypes'
import { Bot, ChevronsDownUp, ChevronsUpDown, Clock, History, ListFilter } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceList } from './ResourceList'

const TOPIC_DISPLAY_OPTIONS: TopicDisplayMode[] = ['time', 'assistant']
const TOPIC_DISPLAY_LABEL_KEYS: Record<TopicDisplayMode, string> = {
  assistant: 'chat.topics.display.assistant',
  time: 'chat.topics.display.time'
}
const TOPIC_DISPLAY_ICONS: Record<TopicDisplayMode, ReactNode> = {
  assistant: <Bot size={16} />,
  time: <Clock size={16} />
}

type TopicListOptionsMenuProps = {
  historyRecordsActive?: boolean
  manageAssistantsActive?: boolean
  mode: TopicDisplayMode
  onChange: (mode: TopicDisplayMode) => void
  onManageAssistants?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  sectionIds?: readonly string[]
}

export function TopicListOptionsMenu({
  historyRecordsActive,
  manageAssistantsActive,
  mode,
  onChange,
  onManageAssistants,
  onOpenHistoryRecords,
  sectionIds
}: TopicListOptionsMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const runAfterMenuClose = (action: () => void) => {
    setOpen(false)
    window.setTimeout(action, 0)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ResourceList.HeaderActionButton type="button" aria-label={t('chat.topics.display.title')}>
          <ListFilter className="block" />
        </ResourceList.HeaderActionButton>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={4} className="w-44 p-1">
        <MenuList>
          <div className="px-2.5 py-1 font-medium text-muted-foreground text-xs">{t('chat.topics.display.title')}</div>
          {TOPIC_DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              size="sm"
              icon={TOPIC_DISPLAY_ICONS[option]}
              label={t(TOPIC_DISPLAY_LABEL_KEYS[option])}
              active={mode === option}
              onClick={() => {
                runAfterMenuClose(() => onChange(option))
              }}
            />
          ))}
          {sectionIds && sectionIds.length > 0 && (
            <>
              <MenuDivider />
              <ResourceList.SectionToggleMenuItem
                size="sm"
                expandIcon={<ChevronsUpDown size={16} />}
                collapseIcon={<ChevronsDownUp size={16} />}
                sectionIds={sectionIds}
                expandLabel={t('chat.topics.group.expand_all')}
                collapseLabel={t('chat.topics.group.collapse_all')}
                onClick={() => {
                  setOpen(false)
                }}
              />
            </>
          )}
          {onOpenHistoryRecords && <MenuDivider />}
          {onOpenHistoryRecords && (
            <MenuItem
              size="sm"
              icon={<History size={16} />}
              label={t('history.records.shortTitle')}
              active={historyRecordsActive}
              onClick={() => {
                setOpen(false)
                onOpenHistoryRecords()
              }}
            />
          )}
          {onManageAssistants && <MenuDivider />}
          {onManageAssistants && (
            <MenuItem
              size="sm"
              icon={<Bot size={16} />}
              label={t('assistants.presets.manage.title')}
              active={manageAssistantsActive}
              onClick={() => {
                setOpen(false)
                void onManageAssistants()
              }}
            />
          )}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
