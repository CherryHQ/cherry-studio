import { CloseOutlined } from '@ant-design/icons'
import type { DraggableProvided, DroppableProvided, DropResult } from '@hello-pangea/dnd'
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { OpenClawSidebarIcon } from '@renderer/components/Icons/SVGIcon'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import { cn } from '@renderer/utils/style'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import {
  Code,
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  MessageSquareQuote,
  MousePointerClick,
  NotepadText,
  Palette,
  Sparkle
} from 'lucide-react'
import type React from 'react'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface SidebarIconsManagerProps {
  visibleIcons: SidebarIcon[]
  invisibleIcons: SidebarIcon[]
  setVisibleIcons: (icons: SidebarIcon[]) => void
  setInvisibleIcons: (icons: SidebarIcon[]) => void
}

type SidebarIconListId = 'visible' | 'disabled'
type SidebarIconLists = {
  visibleIcons: SidebarIcon[]
  invisibleIcons: SidebarIcon[]
}

export function isAssistantSidebarIconMoveBlocked(icon: SidebarIcon | undefined, destination: SidebarIconListId) {
  return icon === 'assistants' && destination === 'disabled'
}

export function moveSidebarIcon(
  icon: SidebarIcon,
  fromList: SidebarIconListId,
  { visibleIcons, invisibleIcons }: SidebarIconLists
): SidebarIconLists | null {
  if (isAssistantSidebarIconMoveBlocked(icon, fromList === 'visible' ? 'disabled' : 'visible')) {
    return null
  }

  if (fromList === 'visible') {
    return {
      visibleIcons: visibleIcons.filter((i) => i !== icon),
      invisibleIcons: invisibleIcons.some((i) => i === icon) ? invisibleIcons : [...invisibleIcons, icon]
    }
  }

  return {
    invisibleIcons: invisibleIcons.filter((i) => i !== icon),
    visibleIcons: visibleIcons.some((i) => i === icon) ? visibleIcons : [...visibleIcons, icon]
  }
}

export function dragSidebarIcon(
  source: { droppableId: SidebarIconListId; index: number },
  destination: { droppableId: SidebarIconListId; index: number },
  { visibleIcons, invisibleIcons }: SidebarIconLists
): SidebarIconLists | null {
  const draggedItem = source.droppableId === 'visible' ? visibleIcons[source.index] : invisibleIcons[source.index]
  if (isAssistantSidebarIconMoveBlocked(draggedItem, destination.droppableId)) {
    return null
  }

  if (source.droppableId === destination.droppableId) {
    const list = source.droppableId === 'visible' ? [...visibleIcons] : [...invisibleIcons]
    const [removed] = list.splice(source.index, 1)
    list.splice(destination.index, 0, removed)

    return source.droppableId === 'visible'
      ? { visibleIcons: list, invisibleIcons }
      : { visibleIcons, invisibleIcons: list }
  }

  const sourceList = source.droppableId === 'visible' ? [...visibleIcons] : [...invisibleIcons]
  const destList = destination.droppableId === 'visible' ? [...visibleIcons] : [...invisibleIcons]
  const [removed] = sourceList.splice(source.index, 1)
  const targetList = destList.filter((icon) => icon !== removed)
  targetList.splice(destination.index, 0, removed)

  return {
    visibleIcons: destination.droppableId === 'visible' ? targetList : sourceList,
    invisibleIcons: destination.droppableId === 'disabled' ? targetList : sourceList
  }
}

const SidebarIconsManager: FC<SidebarIconsManagerProps> = ({
  visibleIcons,
  invisibleIcons,
  setVisibleIcons,
  setInvisibleIcons
}) => {
  const { t } = useTranslation()

  const onDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return

      const { source, destination } = result

      const draggedItem = source.droppableId === 'visible' ? visibleIcons[source.index] : invisibleIcons[source.index]
      if (isAssistantSidebarIconMoveBlocked(draggedItem, destination.droppableId as SidebarIconListId)) {
        window.toast.warning(t('settings.display.sidebar.chat.hiddenMessage'))
        return
      }

      const next = dragSidebarIcon(
        { droppableId: source.droppableId as SidebarIconListId, index: source.index },
        { droppableId: destination.droppableId as SidebarIconListId, index: destination.index },
        { visibleIcons, invisibleIcons }
      )
      if (!next) return

      setVisibleIcons(next.visibleIcons)
      setInvisibleIcons(next.invisibleIcons)
    },
    [visibleIcons, invisibleIcons, setVisibleIcons, setInvisibleIcons, t]
  )

  const onMoveIcon = useCallback(
    (icon: SidebarIcon, fromList: 'visible' | 'disabled') => {
      if (isAssistantSidebarIconMoveBlocked(icon, fromList === 'visible' ? 'disabled' : 'visible')) {
        window.toast.warning(t('settings.display.sidebar.chat.hiddenMessage'))
        return
      }

      const next = moveSidebarIcon(icon, fromList, { visibleIcons, invisibleIcons })
      if (!next) return

      setVisibleIcons(next.visibleIcons)
      setInvisibleIcons(next.invisibleIcons)
    },
    [t, visibleIcons, invisibleIcons, setVisibleIcons, setInvisibleIcons]
  )

  const iconMap = useMemo(
    () =>
      ({
        assistants: <MessageSquareQuote size={16} />,
        agents: <MousePointerClick size={16} />,
        store: <Sparkle size={16} />,
        paintings: <Palette size={16} />,
        translate: <Languages size={16} />,
        minapp: <LayoutGrid size={16} />,
        knowledge: <FileSearch size={16} />,
        files: <Folder size={16} />,
        notes: <NotepadText size={16} />,
        code_tools: <Code size={16} />,
        openclaw: <OpenClawSidebarIcon size={16} />
      }) satisfies Record<SidebarIcon, ReactNode>,
    []
  )

  const renderIcon = (icon: SidebarIcon) => iconMap[icon] || <i className={`iconfont ${icon}`} />

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <IconSection>
        <IconColumn>
          <h4>{t('settings.display.sidebar.visible')}</h4>
          <Droppable droppableId="visible">
            {(provided: DroppableProvided) => (
              <IconList ref={provided.innerRef} {...provided.droppableProps}>
                {visibleIcons.map((icon, index) => (
                  <Draggable key={icon} draggableId={icon} index={index}>
                    {(provided: DraggableProvided) => (
                      <IconItem ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                        <IconContent>
                          {renderIcon(icon)}
                          <span>{getSidebarIconLabel(icon)}</span>
                        </IconContent>
                        {icon !== 'assistants' && (
                          <CloseButton onClick={() => onMoveIcon(icon, 'visible')}>
                            <CloseOutlined />
                          </CloseButton>
                        )}
                      </IconItem>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </IconList>
            )}
          </Droppable>
        </IconColumn>
        <IconColumn>
          <h4>{t('settings.display.sidebar.disabled')}</h4>
          <Droppable droppableId="disabled">
            {(provided: DroppableProvided) => (
              <IconList ref={provided.innerRef} {...provided.droppableProps}>
                {invisibleIcons.length === 0 ? (
                  <EmptyPlaceholder>{t('settings.display.sidebar.empty')}</EmptyPlaceholder>
                ) : (
                  invisibleIcons.map((icon, index) => (
                    <Draggable key={icon} draggableId={icon} index={index}>
                      {(provided: DraggableProvided) => (
                        <IconItem ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                          <IconContent>
                            {renderIcon(icon)}
                            <span>{getSidebarIconLabel(icon)}</span>
                          </IconContent>
                          <CloseButton onClick={() => onMoveIcon(icon, 'disabled')}>
                            <CloseOutlined />
                          </CloseButton>
                        </IconItem>
                      )}
                    </Draggable>
                  ))
                )}
                {provided.placeholder}
              </IconList>
            )}
          </Droppable>
        </IconColumn>
      </IconSection>
    </DragDropContext>
  )
}

const IconSection = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex gap-5 bg-background', className)} {...props} />
)

const IconColumn = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex-1 [&_h4]:mb-2.5 [&_h4]:font-normal [&_h4]:text-foreground', className)} {...props} />
)

type DivWithElementRefProps = React.ComponentPropsWithoutRef<'div'> & { ref?: React.Ref<HTMLElement> }

const IconList = ({ ref, className, ...props }: DivWithElementRefProps) => (
  <div
    ref={ref as React.Ref<HTMLDivElement>}
    className={cn(
      'flex h-[400px] min-h-[400px] flex-col overflow-y-auto rounded-lg border border-border bg-background-subtle p-2.5',
      className
    )}
    {...props}
  />
)

const IconItem = ({ ref, className, ...props }: DivWithElementRefProps) => (
  <div
    ref={ref as React.Ref<HTMLDivElement>}
    className={cn(
      'group mb-2 flex cursor-move items-center justify-between rounded border border-border bg-card px-3 py-2',
      className
    )}
    {...props}
  />
)

const IconContent = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'flex items-center gap-2.5 text-foreground [&_.iconfont]:text-base [&_.iconfont]:text-foreground [&_span]:text-foreground',
      className
    )}
    {...props}
  />
)

const CloseButton = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'cursor-pointer text-foreground-secondary opacity-0 transition-all hover:text-foreground group-hover:opacity-100',
      className
    )}
    {...props}
  />
)

const EmptyPlaceholder = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'flex flex-1 items-center justify-center p-5 text-center text-foreground-secondary text-sm',
      className
    )}
    {...props}
  />
)

export default SidebarIconsManager
