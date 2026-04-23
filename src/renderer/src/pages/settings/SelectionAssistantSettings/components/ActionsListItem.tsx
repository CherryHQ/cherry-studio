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
      'mb-2 flex cursor-move items-center justify-between rounded-md border border-border bg-background-subtle px-4 py-3 transition-colors last:mb-0 hover:bg-accent',
      disabled && 'opacity-80',
      className === 'non-draggable' && 'relative cursor-default bg-accent',
      className
    )}
    {...props}
  />
)

const ItemLeft = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex flex-1 items-center', className)} {...props} />
)

const ItemName = ({
  className,
  disabled,
  ...props
}: React.ComponentPropsWithoutRef<'span'> & { disabled: boolean }) => (
  <span className={cn('ml-2', disabled ? 'text-foreground-muted' : 'text-foreground', className)} {...props} />
)

const ItemIcon = ({ className, disabled, ...props }: React.ComponentPropsWithoutRef<'div'> & { disabled: boolean }) => (
  <div
    className={cn(
      'mx-2 flex items-center justify-center',
      disabled ? 'text-foreground-muted' : 'text-primary',
      className
    )}
    {...props}
  />
)

const ItemDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('ml-4 flex items-center gap-1 text-foreground-secondary text-xs opacity-80', className)}
    {...props}
  />
)

const UserActionOpSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'flex flex-row items-center gap-2 [&_.btn-icon-delete:hover]:text-destructive [&_.btn-icon-delete]:text-foreground-muted [&_.btn-icon-edit:hover]:text-primary [&_.btn-icon-edit]:text-foreground-muted',
      className
    )}
    {...props}
  />
)

export default ActionsListItem
