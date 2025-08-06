import { CloseOutlined } from '@ant-design/icons'
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  Droppable,
  DroppableProvided,
  DropResult
} from '@hello-pangea/dnd'
import { getSidebarIconLabel } from '@renderer/i18n/label'
import { useAppDispatch } from '@renderer/store'
import { setSidebarIcons } from '@renderer/store/settings'
import { message } from 'antd'
import {
  FileSearch,
  Folder,
  Languages,
  LayoutGrid,
  MessageSquareQuote,
  NotepadText,
  Palette,
  Sparkle
} from 'lucide-react'
import { FC, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SidebarIcon } from '../../../store/settings'

interface SidebarIconsManagerProps {
  visibleIcons: SidebarIcon[]
  disabledIcons: SidebarIcon[]
  setVisibleIcons: (icons: SidebarIcon[]) => void
  setDisabledIcons: (icons: SidebarIcon[]) => void
}

const SidebarIconsManager: FC<SidebarIconsManagerProps> = ({
  visibleIcons,
  disabledIcons,
  setVisibleIcons,
  setDisabledIcons
}) => {
  const { t } = useTranslation()

  const dispatch = useAppDispatch()

  const onDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return

      const { source, destination } = result

      // 如果是chat图标且目标是disabled区域,则不允许移动并提示
      const draggedItem = source.droppableId === 'visible' ? visibleIcons[source.index] : disabledIcons[source.index]
      if (draggedItem === 'assistants' && destination.droppableId === 'disabled') {
        message.warning(t('settings.display.sidebar.chat.hiddenMessage'))
        return
      }

      if (source.droppableId === destination.droppableId) {
        const list = source.droppableId === 'visible' ? [...visibleIcons] : [...disabledIcons]
        const [removed] = list.splice(source.index, 1)
        list.splice(destination.index, 0, removed)

        if (source.droppableId === 'visible') {
          setVisibleIcons(list)
          dispatch(setSidebarIcons({ visible: list, disabled: disabledIcons }))
        } else {
          setDisabledIcons(list)
          dispatch(setSidebarIcons({ visible: visibleIcons, disabled: list }))
        }
        return
      }

      const sourceList = source.droppableId === 'visible' ? [...visibleIcons] : [...disabledIcons]
      const destList = destination.droppableId === 'visible' ? [...visibleIcons] : [...disabledIcons]

      const [removed] = sourceList.splice(source.index, 1)
      const targetList = destList.filter((icon) => icon !== removed)
      targetList.splice(destination.index, 0, removed)

      const newVisibleIcons = destination.droppableId === 'visible' ? targetList : sourceList
      const newDisabledIcons = destination.droppableId === 'disabled' ? targetList : sourceList

      setVisibleIcons(newVisibleIcons)
      setDisabledIcons(newDisabledIcons)
      dispatch(setSidebarIcons({ visible: newVisibleIcons, disabled: newDisabledIcons }))
    },
    [visibleIcons, disabledIcons, dispatch, setVisibleIcons, setDisabledIcons, t]
  )

  const onMoveIcon = useCallback(
    (icon: SidebarIcon, fromList: 'visible' | 'disabled') => {
      // 如果是chat图标且要移动到disabled列表,则不允许并提示
      if (icon === 'assistants' && fromList === 'visible') {
        message.warning(t('settings.display.sidebar.chat.hiddenMessage'))
        return
      }

      if (fromList === 'visible') {
        const newVisibleIcons = visibleIcons.filter((i) => i !== icon)
        const newDisabledIcons = disabledIcons.some((i) => i === icon) ? disabledIcons : [...disabledIcons, icon]

        setVisibleIcons(newVisibleIcons)
        setDisabledIcons(newDisabledIcons)
        dispatch(setSidebarIcons({ visible: newVisibleIcons, disabled: newDisabledIcons }))
      } else {
        const newDisabledIcons = disabledIcons.filter((i) => i !== icon)
        const newVisibleIcons = visibleIcons.some((i) => i === icon) ? visibleIcons : [...visibleIcons, icon]

        setDisabledIcons(newDisabledIcons)
        setVisibleIcons(newVisibleIcons)
        dispatch(setSidebarIcons({ visible: newVisibleIcons, disabled: newDisabledIcons }))
      }
    },
    [t, visibleIcons, disabledIcons, setVisibleIcons, setDisabledIcons, dispatch]
  )

  // 使用useMemo缓存图标映射
  const iconMap = useMemo(
    () => ({
      assistants: <MessageSquareQuote size={16} />,
      agents: <Sparkle size={16} />,
      paintings: <Palette size={16} />,
      translate: <Languages size={16} />,
      minapp: <LayoutGrid size={16} />,
      knowledge: <FileSearch size={16} />,
      files: <Folder size={16} />,
      notes: <NotepadText size={16} />
    }),
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
                {disabledIcons.length === 0 ? (
                  <EmptyPlaceholder>{t('settings.display.sidebar.empty')}</EmptyPlaceholder>
                ) : (
                  disabledIcons.map((icon, index) => (
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

// Styled components remain the same
const IconSection = styled.div`
  display: flex;
  gap: 20px;
  padding: 10px;
  background: var(--color-background);
`

const IconColumn = styled.div`
  flex: 1;

  h4 {
    margin-bottom: 10px;
    color: var(--color-text);
    font-weight: normal;
  }
`

const IconList = styled.div`
  height: 365px;
  min-height: 365px;
  padding: 10px;
  background: var(--color-background-soft);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
`

const IconItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: move;
`

const IconContent = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;

  .iconfont {
    font-size: 16px;
    color: var(--color-text);
  }

  span {
    color: var(--color-text);
  }
`

const CloseButton = styled.div`
  cursor: pointer;
  color: var(--color-text-2);
  opacity: 0;
  transition: all 0.2s;

  &:hover {
    color: var(--color-text);
  }

  ${IconItem}:hover & {
    opacity: 1;
  }
`

const EmptyPlaceholder = styled.div`
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  color: var(--color-text-2);
  text-align: center;
  padding: 20px;
  font-size: 14px;
`

export default SidebarIconsManager
