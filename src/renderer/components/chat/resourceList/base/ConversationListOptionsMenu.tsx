import { ChevronsDownUp, ChevronsUpDown, Group, MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip
} from '@cherrystudio/ui'

import { ResourceList } from './ResourceList'

type ConversationListOption<TMode extends string> = {
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
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selectedOption = options.find((option) => option.value === mode)

  const runAfterMenuClose = (action: () => void) => {
    setOpen(false)
    window.setTimeout(action, 0)
  }

  const renderAction = (action: ConversationListMenuAction) => (
    <DropdownMenuItem
      aria-current={action.active ? 'page' : undefined}
      className={action.active ? 'bg-accent' : undefined}
      onSelect={() => {
        setOpen(false)
        void action.onSelect()
      }}>
      {action.icon}
      <span>{action.label}</span>
    </DropdownMenuItem>
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip title={t('chat.list.options')} delay={500}>
        <DropdownMenuTrigger asChild>
          <ResourceList.HeaderActionButton type="button" aria-label={t('chat.list.options')}>
            <MoreHorizontal className="block" />
          </ResourceList.HeaderActionButton>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-max min-w-48 max-w-(--radix-dropdown-menu-content-available-width)">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Group size={16} />
            <span className="flex-1">{title}</span>
            <span className="text-muted-foreground text-xs">{selectedOption?.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={mode} aria-label={title}>
                {options.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => runAfterMenuClose(() => onChange(option.value))}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        {sectionToggle && sectionToggle.ids.length > 0 && (
          <DropdownMenuItem asChild>
            <ResourceList.SectionToggleMenuItem
              className="gap-2 rounded-sm px-2"
              expandIcon={<ChevronsUpDown size={16} />}
              collapseIcon={<ChevronsDownUp size={16} />}
              sectionIds={sectionToggle.ids}
              expandLabel={sectionToggle.expandLabel}
              collapseLabel={sectionToggle.collapseLabel}
              onClick={() => setOpen(false)}
            />
          </DropdownMenuItem>
        )}
        {(historyAction || manageAction) && (
          <>
            <DropdownMenuSeparator />
            {historyAction && renderAction(historyAction)}
            {manageAction && renderAction(manageAction)}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
