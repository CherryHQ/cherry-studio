import { Button } from '@cherrystudio/ui'
import type { DraggableProvided } from '@hello-pangea/dnd'
import { cn } from '@renderer/utils/style'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { Pencil, Settings2, Trash } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import type React from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

interface ActionItemProps {
  item: SelectionActionItem
  provided: DraggableProvided
  listType: 'enabled' | 'disabled'
  isLastEnabledItem: boolean
  onEdit: (item: SelectionActionItem) => void
  onDelete: (id: string) => void
  getSearchEngineInfo: (engine: string) => { icon: any; name: string } | null
}

const ActionsListItem = memo(
  ({ item, provided, listType, isLastEnabledItem, onEdit, onDelete, getSearchEngineInfo }: ActionItemProps) => {
    const { t } = useTranslation()
    const isEnabled = listType === 'enabled'

    return (
      <Item
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...(isLastEnabledItem ? {} : provided.dragHandleProps)}
        disabled={!isEnabled}
        className={isLastEnabledItem ? 'non-draggable' : ''}>
        <ItemLeft>
          <ItemIcon disabled={!isEnabled}>
            <DynamicIcon name={item.icon as any} size={16} fallback={() => <div style={{ width: 16, height: 16 }} />} />
          </ItemIcon>
          <ItemName disabled={!isEnabled}>{item.isBuiltIn ? t(item.name) : item.name}</ItemName>
          {item.id === 'search' && item.searchEngine && (
            <ItemDescription>
              {getSearchEngineInfo(item.searchEngine)?.icon}
              <span>{getSearchEngineInfo(item.searchEngine)?.name}</span>
            </ItemDescription>
          )}
        </ItemLeft>

        <ActionOperations item={item} onEdit={onEdit} onDelete={onDelete} />
      </Item>
    )
  }
)

interface ActionOperationsProps {
  item: SelectionActionItem
  onEdit: (item: SelectionActionItem) => void
  onDelete: (id: string) => void
}

const ActionOperations = memo(({ item, onEdit, onDelete }: ActionOperationsProps) => {
  if (!item.isBuiltIn) {
    return (
      <UserActionOpSection>
        <Button variant="ghost" size="icon-sm" onClick={() => onEdit(item)}>
          <Pencil size={16} className="btn-icon-edit" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => onDelete(item.id)}>
          <Trash size={16} className="btn-icon-delete" />
        </Button>
      </UserActionOpSection>
    )
  }

  if (item.isBuiltIn && item.id === 'search') {
    return (
      <UserActionOpSection>
        <Button variant="ghost" size="icon-sm" onClick={() => onEdit(item)}>
          <Settings2 size={16} className="btn-icon-edit" />
        </Button>
      </UserActionOpSection>
    )
  }

  return null
})

const Item = ({
  ref,
  className,
  disabled,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { disabled: boolean; ref?: React.Ref<HTMLElement> }) => (
  <div
    ref={ref as React.Ref<HTMLDivElement>}
    className={cn(
      'group/action-item mb-2 flex min-h-11 cursor-move items-center justify-between rounded-md border border-border/60 bg-transparent px-4 py-2 transition-colors last:mb-0 hover:border-border hover:bg-muted/50',
      disabled && 'opacity-70 hover:bg-muted/30',
      className === 'non-draggable' && 'relative cursor-default border-border/80 bg-muted/50 hover:bg-muted/50',
      className
    )}
    {...props}
  />
)

const ItemLeft = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex min-w-0 flex-1 items-center', className)} {...props} />
)

const ItemName = ({
  className,
  disabled,
  ...props
}: React.ComponentPropsWithoutRef<'span'> & { disabled: boolean }) => (
  <span className={cn('ml-2 truncate', disabled ? 'text-foreground-muted' : 'text-foreground', className)} {...props} />
)

const ItemIcon = ({ className, disabled, ...props }: React.ComponentPropsWithoutRef<'div'> & { disabled: boolean }) => (
  <div
    className={cn(
      'mx-2 flex items-center justify-center',
      disabled ? 'text-muted-foreground/70' : 'text-muted-foreground group-hover/action-item:text-foreground',
      className
    )}
    {...props}
  />
)

const ItemDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'ml-4 flex h-5 shrink-0 items-center gap-1 rounded-sm bg-muted/50 px-1.5 text-muted-foreground text-xs leading-none',
      className
    )}
    {...props}
  />
)

const UserActionOpSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'flex flex-row items-center gap-2 [&_.btn-icon-delete:hover]:text-destructive [&_.btn-icon-delete]:text-muted-foreground [&_.btn-icon-edit:hover]:text-foreground [&_.btn-icon-edit]:text-muted-foreground',
      className
    )}
    {...props}
  />
)

export default ActionsListItem
