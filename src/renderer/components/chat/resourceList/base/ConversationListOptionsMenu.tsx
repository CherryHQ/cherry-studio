import { MenuDivider, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { ChevronsDownUp, ChevronsUpDown, ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

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

type ConversationListOptionGroup<TValue extends string> = {
  onChange: (value: TValue) => void
  options: readonly ConversationListOption<TValue>[]
  title: string
  value: TValue
}

type ConversationListOptionsMenuProps<TMode extends string, TSort extends string> = {
  historyAction?: ConversationListMenuAction
  manageAction?: ConversationListMenuAction
  mode: TMode
  onChange: (mode: TMode) => void
  options: readonly ConversationListOption<TMode>[]
  sectionToggle?: ConversationListSectionToggle
  sort?: ConversationListOptionGroup<TSort>
  title: string
}

export function ConversationListOptionsMenu<TMode extends string, TSort extends string>({
  historyAction,
  manageAction,
  mode,
  onChange,
  options,
  sectionToggle,
  sort,
  title
}: ConversationListOptionsMenuProps<TMode, TSort>) {
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
          {sort && (
            <>
              <MenuDivider />
              <div className="px-2.5 py-1 font-normal text-muted-foreground text-xs">{sort.title}</div>
              {sort.options.map((option) => (
                <MenuItem
                  key={option.value}
                  size="sm"
                  icon={option.icon}
                  label={option.label}
                  active={sort.value === option.value}
                  onClick={() => runAfterMenuClose(() => sort.onChange(option.value))}
                />
              ))}
            </>
          )}
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
