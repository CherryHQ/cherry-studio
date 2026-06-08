import {
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger
} from '@cherrystudio/ui'
import { DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY } from '@renderer/pages/knowledge/utils'
import { ArrowRightLeft, PencilLine, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { KnowledgeBaseRowMenuProps, KnowledgeGroupRowMenuProps, NavigatorRowMenuProps } from './types'

const NavigatorRowMenuItem = ({ icon, label, onClick }: { icon?: ReactNode; label: string; onClick: () => void }) => {
  return (
    <MenuItem variant="ghost" icon={icon} label={label} className="h-8 rounded-lg px-2.5 text-sm" onClick={onClick} />
  )
}

const NavigatorRowDeleteMenuItem = ({
  icon,
  label,
  onClick
}: {
  icon?: ReactNode
  label: string
  onClick: () => void
}) => {
  return (
    <MenuItem
      variant="ghost"
      icon={icon}
      label={label}
      className="h-8 rounded-lg px-2.5 text-destructive text-sm hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/20"
      onClick={onClick}
    />
  )
}

export const NavigatorRowMenu = ({ open, menuPosition, trigger, onOpenChange, children }: NavigatorRowMenuProps) => {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>

      {menuPosition ? (
        <PopoverAnchor
          className="fixed size-0"
          style={{
            left: menuPosition.x,
            top: menuPosition.y
          }}
        />
      ) : null}

      <PopoverContent
        align={menuPosition ? 'start' : 'end'}
        side="bottom"
        sideOffset={8}
        collisionPadding={8}
        className="z-300 w-45 rounded-xl border-border bg-popover p-1.5 shadow-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}>
        {children}
      </PopoverContent>
    </Popover>
  )
}

export const KnowledgeBaseRowMenu = ({
  open,
  menuPosition,
  trigger,
  onOpenChange,
  availableGroups,
  canMoveToUngrouped,
  onRename,
  onMove,
  onRequestDelete
}: KnowledgeBaseRowMenuProps) => {
  const { t } = useTranslation()

  return (
    <NavigatorRowMenu open={open} menuPosition={menuPosition} trigger={trigger} onOpenChange={onOpenChange}>
      <MenuList className="gap-1">
        <NavigatorRowMenuItem
          icon={<PencilLine className="size-3.5" />}
          label={t('knowledge.context.rename')}
          onClick={onRename}
        />

        {availableGroups.length > 0 || canMoveToUngrouped ? (
          <>
            <div className="px-2.5 pt-1 pb-0.5 text-foreground-muted text-xs leading-4">
              {t('knowledge.context.move_to')}
            </div>

            {canMoveToUngrouped ? (
              <NavigatorRowMenuItem
                icon={<ArrowRightLeft className="size-3.5" />}
                label={t(DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY)}
                onClick={() => void onMove(null)}
              />
            ) : null}

            {availableGroups.map((group) => (
              <NavigatorRowMenuItem
                key={group.id}
                icon={<ArrowRightLeft className="size-3.5" />}
                label={group.name}
                onClick={() => void onMove(group.id)}
              />
            ))}

            <MenuDivider />
          </>
        ) : null}

        <NavigatorRowDeleteMenuItem
          icon={<Trash2 className="size-3.5" />}
          label={t('knowledge.context.delete')}
          onClick={onRequestDelete}
        />
      </MenuList>
    </NavigatorRowMenu>
  )
}

export const KnowledgeGroupRowMenu = ({
  open,
  menuPosition,
  trigger,
  onOpenChange,
  onRename,
  onCreateBase,
  onRequestDelete
}: KnowledgeGroupRowMenuProps) => {
  const { t } = useTranslation()

  return (
    <NavigatorRowMenu open={open} menuPosition={menuPosition} trigger={trigger} onOpenChange={onOpenChange}>
      <MenuList className="gap-1">
        <NavigatorRowMenuItem
          icon={<PencilLine className="size-3.5" />}
          label={t('knowledge.context.rename')}
          onClick={onRename}
        />
        <NavigatorRowMenuItem
          icon={<Plus className="size-3.5" />}
          label={t('knowledge.groups.create_base_here')}
          onClick={onCreateBase}
        />
        <MenuDivider />
        <NavigatorRowDeleteMenuItem
          icon={<Trash2 className="size-3.5" />}
          label={t('knowledge.groups.delete')}
          onClick={onRequestDelete}
        />
      </MenuList>
    </NavigatorRowMenu>
  )
}
