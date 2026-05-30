import { Button, MenuDivider, MenuItem, MenuList, Popover, PopoverAnchor, PopoverContent } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { ArrowRightLeft, MoreHorizontal, PencilLine, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  KnowledgeBaseRowMenuProps,
  KnowledgeGroupRowMenuProps,
  NavigatorMoreButtonProps,
  NavigatorRowMenuProps
} from './types'

const NavigatorRowMenuIcon = ({ children }: { children: ReactNode }) => {
  return <span className="[&_svg]:size-2.75">{children}</span>
}

const NavigatorRowMenuItem = ({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) => {
  return (
    <MenuItem
      variant="ghost"
      size="sm"
      icon={<NavigatorRowMenuIcon>{icon}</NavigatorRowMenuIcon>}
      label={label}
      className="gap-2 rounded-md px-2 py-1 font-normal text-popover-foreground"
      onClick={onClick}
    />
  )
}

const NavigatorRowDeleteMenuItem = ({
  icon,
  label,
  onClick
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) => {
  return (
    <MenuItem
      variant="ghost"
      size="sm"
      icon={<NavigatorRowMenuIcon>{icon}</NavigatorRowMenuIcon>}
      label={label}
      className="gap-2 rounded-md px-2 py-1 font-normal text-red-500 hover:bg-red-500/10 hover:text-red-500 focus-visible:ring-red-500/20"
      onClick={onClick}
    />
  )
}

export const NavigatorMoreButton = ({ visible, className, onClick }: NavigatorMoreButtonProps) => {
  const { t } = useTranslation()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t('common.more')}
      className={cn(
        'size-4 min-h-4 min-w-4 shrink-0 rounded p-0 text-muted-foreground/35 shadow-none transition-all duration-150 hover:bg-transparent hover:text-foreground',
        visible ? 'opacity-100' : 'opacity-0',
        className
      )}
      onClick={onClick}>
      <MoreHorizontal className="size-2.5" />
    </Button>
  )
}

export const NavigatorRowMenu = ({ menuPosition, onClose, children }: NavigatorRowMenuProps) => {
  return (
    <Popover
      open={Boolean(menuPosition)}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}>
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
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={8}
        className="z-300 min-w-32.5 rounded-lg p-1 shadow-xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}>
        {children}
      </PopoverContent>
    </Popover>
  )
}

export const KnowledgeBaseRowMenu = ({
  menuPosition,
  availableGroups,
  canMoveToUngrouped,
  onClose,
  onRename,
  onMove,
  onRequestDelete
}: KnowledgeBaseRowMenuProps) => {
  const { t } = useTranslation()

  return (
    <NavigatorRowMenu menuPosition={menuPosition} onClose={onClose}>
      <MenuList className="gap-0.5">
        <NavigatorRowMenuItem icon={<PencilLine />} label={t('knowledge.context.rename')} onClick={onRename} />

        {availableGroups.length > 0 || canMoveToUngrouped ? (
          <>
            <div className="px-2 pt-1 pb-0.5 text-muted-foreground/70 text-xs leading-4">
              {t('knowledge.context.move_to')}
            </div>

            {canMoveToUngrouped ? (
              <NavigatorRowMenuItem
                icon={<ArrowRightLeft />}
                label={t('knowledge.groups.ungrouped')}
                onClick={() => void onMove(null)}
              />
            ) : null}

            {availableGroups.map((group) => (
              <NavigatorRowMenuItem
                key={group.id}
                icon={<ArrowRightLeft />}
                label={group.name}
                onClick={() => void onMove(group.id)}
              />
            ))}

            <MenuDivider />
          </>
        ) : null}

        <NavigatorRowDeleteMenuItem icon={<Trash2 />} label={t('knowledge.context.delete')} onClick={onRequestDelete} />
      </MenuList>
    </NavigatorRowMenu>
  )
}

export const KnowledgeGroupRowMenu = ({
  menuPosition,
  onClose,
  onRename,
  onCreateBase,
  onRequestDelete
}: KnowledgeGroupRowMenuProps) => {
  const { t } = useTranslation()

  return (
    <NavigatorRowMenu menuPosition={menuPosition} onClose={onClose}>
      <MenuList className="gap-0.5">
        <NavigatorRowMenuItem icon={<PencilLine />} label={t('knowledge.context.rename')} onClick={onRename} />
        <NavigatorRowMenuItem icon={<Plus />} label={t('knowledge.groups.create_base_here')} onClick={onCreateBase} />
        <MenuDivider />
        <NavigatorRowDeleteMenuItem icon={<Trash2 />} label={t('knowledge.groups.delete')} onClick={onRequestDelete} />
      </MenuList>
    </NavigatorRowMenu>
  )
}
