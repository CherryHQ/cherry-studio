import { MenuDivider, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import type { AgentSessionDisplayMode } from '@shared/data/preference/preferenceTypes'
import { Bot, ChevronsDownUp, ChevronsUpDown, Clock, Folder, History, ListFilter } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ResourceList } from './ResourceList'

const SESSION_DISPLAY_OPTIONS: AgentSessionDisplayMode[] = ['time', 'workdir', 'agent']
export const SESSION_DISPLAY_LABEL_KEYS: Record<AgentSessionDisplayMode, string> = {
  agent: 'agent.session.display.agent',
  time: 'agent.session.display.time',
  workdir: 'agent.session.display.workdir'
}
const SESSION_DISPLAY_ICONS: Record<AgentSessionDisplayMode, ReactNode> = {
  agent: <Bot size={16} />,
  time: <Clock size={16} />,
  workdir: <Folder size={16} />
}

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
  sectionIds?: readonly string[]
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
  sectionIds
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ResourceList.HeaderActionButton type="button" aria-label={t('agent.session.display.title')}>
          <ListFilter className="block" />
        </ResourceList.HeaderActionButton>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={4} className="w-44 p-1">
        <MenuList>
          <div className="px-2.5 py-1 font-medium text-muted-foreground text-xs">
            {t('agent.session.display.title')}
          </div>
          {SESSION_DISPLAY_OPTIONS.map((option) => (
            <MenuItem
              key={option}
              size="sm"
              icon={SESSION_DISPLAY_ICONS[option]}
              label={t(SESSION_DISPLAY_LABEL_KEYS[option])}
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
                expandLabel={t('agent.session.group.expand_all')}
                collapseLabel={t('agent.session.group.collapse_all')}
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
          {hasManagementItems && <MenuDivider />}
          {onManageAgents && (
            <MenuItem
              size="sm"
              icon={<Bot size={16} />}
              label={t('agent.manage.title')}
              active={manageAgentsActive}
              onClick={() => {
                setOpen(false)
                void onManageAgents()
              }}
            />
          )}
          {onManageSkills && (
            <MenuItem
              size="sm"
              icon={manageSkillsMenuIcon}
              label={t('agent.skill.manage.title')}
              active={manageSkillsActive}
              onClick={() => {
                setOpen(false)
                void onManageSkills()
              }}
            />
          )}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
