import { CloseOutlined } from '@ant-design/icons'
import type { DraggableProvided, DroppableProvided, DropResult } from '@hello-pangea/dnd'
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { LogoAvatar } from '@renderer/components/Icons'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { getMiniAppsStatusLabel } from '@renderer/i18n/label'
import type { MiniApp } from '@shared/data/types/miniApp'
import type { FC } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface MiniAppManagerProps {
  visibleMiniApps: MiniApp[]
  disabledMiniApps: MiniApp[]
  setVisibleMiniApps: (programs: MiniApp[]) => void
  setDisabledMiniApps: (programs: MiniApp[]) => void
}

type ListType = 'visible' | 'disabled'

const MiniAppIconsManager: FC<MiniAppManagerProps> = ({
  visibleMiniApps,
  disabledMiniApps,
  setVisibleMiniApps,
  setDisabledMiniApps
}) => {
  const { t } = useTranslation()
  const { pinned, updateMiniApps, updateDisabledMiniApps, updatePinnedMiniApps } = useMiniApps()

  const handleListUpdate = useCallback(
    (newVisible: MiniApp[], newDisabled: MiniApp[]) => {
      setVisibleMiniApps(newVisible)
      setDisabledMiniApps(newDisabled)
      void updateMiniApps(newVisible)
      void updateDisabledMiniApps(newDisabled)
      const disabledIds = new Set(newDisabled.map((d) => d.appId))
      void updatePinnedMiniApps(pinned.filter((p) => !disabledIds.has(p.appId)))
    },
    [pinned, setDisabledMiniApps, setVisibleMiniApps, updateDisabledMiniApps, updateMiniApps, updatePinnedMiniApps]
  )

  const onDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return

      const { source, destination } = result

      if (source.droppableId === destination.droppableId) {
        // Reorder within the same list
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

      // Move between different lists
      const sourceList = source.droppableId === 'visible' ? [...visibleMiniApps] : [...disabledMiniApps]
      const destList = destination.droppableId === 'visible' ? [...visibleMiniApps] : [...disabledMiniApps]

      const [removed] = sourceList.splice(source.index, 1)
      const targetList = destList.filter((app) => app.appId !== removed.appId)
      targetList.splice(destination.index, 0, removed)

      const newVisibleMiniApps = destination.droppableId === 'visible' ? targetList : sourceList
      const newDisabledMiniApps = destination.droppableId === 'disabled' ? targetList : sourceList

      handleListUpdate(newVisibleMiniApps, newDisabledMiniApps)
    },
    [visibleMiniApps, disabledMiniApps, handleListUpdate]
  )

  const onMoveMiniApp = useCallback(
    (program: MiniApp, fromList: ListType) => {
      const isMovingToVisible = fromList === 'disabled'
      const newVisible = isMovingToVisible
        ? [...visibleMiniApps, program]
        : visibleMiniApps.filter((p) => p.appId !== program.appId)
      const newDisabled = isMovingToVisible
        ? disabledMiniApps.filter((p) => p.appId !== program.appId)
        : [...disabledMiniApps, program]

      handleListUpdate(newVisible, newDisabled)
    },
    [visibleMiniApps, disabledMiniApps, handleListUpdate]
  )

  const renderProgramItem = (program: MiniApp, provided: DraggableProvided, listType: ListType) => {
    const name = program.nameKey ? t(program.nameKey) : program.name

    return (
      <ProgramItem ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
        <ProgramContent>
          <LogoAvatar logo={program.logo} size={16} />
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
            <h4>{getMiniAppsStatusLabel(listType)}</h4>
            <Droppable droppableId={listType}>
              {(provided: DroppableProvided) => (
                <ProgramList ref={provided.innerRef} {...provided.droppableProps}>
                  {(listType === 'visible' ? visibleMiniApps : disabledMiniApps).map((program, index) => (
                    <Draggable key={program.appId} draggableId={String(program.appId)} index={index}>
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
