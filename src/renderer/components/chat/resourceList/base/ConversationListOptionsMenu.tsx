import { ChevronsDownUp, ChevronsUpDown, ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { MenuDivider, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'

import { ResourceList } from './ResourceList'

type ConversationListOption<TMode extends string> = {
  icon: ReactNode
  label: string
  value: TMode
}

type ConversationListMenuAction = {
  active?: boolean
  icon: ReactNode
  label: string
  onSelect: () => void | Promise<void>
}

type ConversationListSectionToggle = {
  collapseLabel: string
  expandLabel: string
  ids: readonly string[]
}

type ConversationListOptionsMenuProps<TMode extends string> = {
  historyAction?: ConversationListMenuAction
  manageAction?: ConversationListMenuAction
  mode: TMode
  onChange: (mode: TMode) => void
  options: readonly ConversationListOption<TMode>[]
  sectionToggle?: ConversationListSectionToggle
  title: string
}

export function ConversationListOptionsMenu<TMode extends string>({
  historyAction,
  manageAction,
  mode,
  onChange,
  options,
  sectionToggle,
  title
}: ConversationListOptionsMenuProps<TMode>) {
  const [open, setOpen] = useState(false)
  const runAfterMenuClose = (action: () => void) => {
    setOpen(false)
    window.setTimeout(action, 0)
  }

  const renderAction = (action: ConversationListMenuAction) => (
    <MenuItem
      size="sm"
      icon={action.icon}
      label={action.label}
      active={action.active}
      onClick={() => {
        setOpen(false)
        void action.onSelect()
      }}
    />
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ResourceList.HeaderActionButton type="button" aria-label={title}>
          <ListFilter className="block" />
        </ResourceList.HeaderActionButton>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" sideOffset={4} className="w-44 p-1">
        <MenuList>
          <div className="px-2.5 py-1 font-normal text-muted-foreground text-xs">{title}</div>
          {options.map((option) => (
            <MenuItem
              key={option.value}
              size="sm"
              icon={option.icon}
              label={option.label}
              active={mode === option.value}
              onClick={() => runAfterMenuClose(() => onChange(option.value))}
            />
          ))}
          {sectionToggle && sectionToggle.ids.length > 0 && (
            <>
              <MenuDivider />
              <ResourceList.SectionToggleMenuItem
                size="sm"
                expandIcon={<ChevronsUpDown size={16} />}
                collapseIcon={<ChevronsDownUp size={16} />}
                sectionIds={sectionToggle.ids}
                expandLabel={sectionToggle.expandLabel}
                collapseLabel={sectionToggle.collapseLabel}
                onClick={() => setOpen(false)}
              />
            </>
          )}
          {historyAction && (
            <>
              <MenuDivider />
              {renderAction(historyAction)}
            </>
          )}
          {manageAction && (
            <>
              <MenuDivider />
              {renderAction(manageAction)}
            </>
          )}
        </MenuList>
      </PopoverContent>
    </Popover>
  )
}
