import { CloseOutlined } from '@ant-design/icons'
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  Droppable,
  DroppableProvided,
  DropResult
} from '@hello-pangea/dnd'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { getMiniappsStatusLabel } from '@renderer/i18n/label'
import { MinAppType } from '@renderer/types'
import { FC, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface MiniAppManagerProps {
  visibleMiniApps: MinAppType[]
  disabledMiniApps: MinAppType[]
  setVisibleMiniApps: (programs: MinAppType[]) => void
  setDisabledMiniApps: (programs: MinAppType[]) => void
}

type ListType = 'visible' | 'disabled'

const MiniAppIconsManager: FC<MiniAppManagerProps> = ({
  visibleMiniApps,
  disabledMiniApps,
  setVisibleMiniApps,
  setDisabledMiniApps
}) => {
  const { t } = useTranslation()
  const { pinned, updateMinapps, updateDisabledMinapps, updatePinnedMinapps } = useMinapps()

  const handleListUpdate = useCallback(
    (newVisible: MinAppType[], newDisabled: MinAppType[]) => {
      setVisibleMiniApps(newVisible)
      setDisabledMiniApps(newDisabled)
      updateMinapps(newVisible)
      updateDisabledMinapps(newDisabled)
      updatePinnedMinapps(pinned.filter((p) => !newDisabled.some((d) => d.id === p.id)))
    },
    [pinned, setDisabledMiniApps, setVisibleMiniApps, updateDisabledMinapps, updateMinapps, updatePinnedMinapps]
  )

  const onDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return

      const { source, destination } = result

      if (source.droppableId === destination.droppableId) {
        // 在同一列表内重新排序
        const list = source.droppableId === 'visible' ? [...visibleMiniApps] : [...disabledMiniApps]
        const [removed] = list.splice(source.index, 1)
        list.splice(destination.index, 0, removed)

        if (source.droppableId === 'visible') {
          handleListUpdate(list, disabledMiniApps)
        } else {
          handleListUpdate(visibleMiniApps, list)
        }
        return
      }

      // 在不同列表间移动
      const sourceList = source.droppableId === 'visible' ? [...visibleMiniApps] : [...disabledMiniApps]
      const destList = destination.droppableId === 'visible' ? [...visibleMiniApps] : [...disabledMiniApps]

      const [removed] = sourceList.splice(source.index, 1)
      const targetList = destList.filter((app) => app.id !== removed.id)
      targetList.splice(destination.index, 0, removed)

      const newVisibleMiniApps = destination.droppableId === 'visible' ? targetList : sourceList
      const newDisabledMiniApps = destination.droppableId === 'disabled' ? targetList : sourceList

      handleListUpdate(newVisibleMiniApps, newDisabledMiniApps)
    },
    [visibleMiniApps, disabledMiniApps, handleListUpdate]
  )

  const onMoveMiniApp = useCallback(
    (program: MinAppType, fromList: ListType) => {
      const isMovingToVisible = fromList === 'disabled'
      const newVisible = isMovingToVisible
        ? [...visibleMiniApps, program]
        : visibleMiniApps.filter((p) => p.id !== program.id)
      const newDisabled = isMovingToVisible
        ? disabledMiniApps.filter((p) => p.id !== program.id)
        : [...disabledMiniApps, program]

      handleListUpdate(newVisible, newDisabled)
    },
    [visibleMiniApps, disabledMiniApps, handleListUpdate]
  )

  const renderProgramItem = (program: MinAppType, provided: DraggableProvided, listType: ListType) => {
    const { name, logo } = DEFAULT_MIN_APPS.find((app) => app.id === program.id) || { name: program.name, logo: '' }

    return (
      <ProgramItem ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
        <ProgramContent>
          <AppLogo src={logo} alt={name} />
          <span>{name}</span>
        </ProgramContent>
        <CloseButton onClick={() => onMoveMiniApp(program, listType)}>
          <CloseOutlined />
        </CloseButton>
      </ProgramItem>
    )
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <ProgramSection style={{ background: 'transparent' }}>
        {(['visible', 'disabled'] as const).map((listType) => (
          <ProgramColumn key={listType}>
            <h4>{getMiniappsStatusLabel(listType)}</h4>
            <Droppable droppableId={listType}>
              {(provided: DroppableProvided) => (
                <ProgramList ref={provided.innerRef} {...provided.droppableProps}>
                  {(listType === 'visible' ? visibleMiniApps : disabledMiniApps).map((program, index) => (
                    <Draggable key={program.id} draggableId={String(program.id)} index={index}>
                      {(provided: DraggableProvided) => renderProgramItem(program, provided, listType)}
                    </Draggable>
                  ))}
                  {disabledMiniApps.length === 0 && listType === 'disabled' && (
                    <EmptyPlaceholder>{t('settings.miniapps.empty')}</EmptyPlaceholder>
                  )}
                  {provided.placeholder}
                </ProgramList>
              )}
            </Droppable>
          </ProgramColumn>
        ))}
      </ProgramSection>
    </DragDropContext>
  )
}

const AppLogo = styled.img`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  object-fit: contain;
`

const ProgramSection = styled.div`
  display: flex;
  gap: 20px;
  padding: 10px;
  background: var(--color-background);
`

const ProgramColumn = styled.div`
  flex: 1;

  h4 {
    margin-bottom: 10px;
    color: var(--color-text);
    font-weight: normal;
  }
`

const ProgramList = styled.div`
  height: 365px;
  min-height: 365px;
  padding: 10px;
  background: var(--color-background-soft);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  overflow-y: auto;

  scroll-behavior: smooth;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--color-border-hover);
  }
`

const ProgramItem = styled.div`
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

const ProgramContent = styled.div`
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

  ${ProgramItem}:hover & {
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

export default MiniAppIconsManager
