import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { Button, Switch } from 'antd'
import { GripVertical } from 'lucide-react'
import { FC, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { InputBoxIconInfo } from './inputBoxIconsUtils'

interface Props {
  icons: InputBoxIconInfo[]
  inputBoxConfig: Record<string, { visible: boolean; position: 'left' | 'right'; order: number }>
  setInputBoxConfig: (config: Record<string, { visible: boolean; position: 'left' | 'right'; order: number }>) => void
}

interface IconConfig {
  visible: boolean
  position: 'left' | 'right'
  order: number
}

const InputBoxIconsManager: FC<Props> = ({ icons, inputBoxConfig, setInputBoxConfig }) => {
  const { t } = useTranslation()

  // 本地状态管理 - 使用 useMemo 优化初始化
  const localConfig = useMemo(() => {
    const config: Record<string, IconConfig> = {}
    icons.forEach((icon) => {
      config[icon.id] = {
        visible: inputBoxConfig[icon.id]?.visible ?? icon.visible,
        position: inputBoxConfig[icon.id]?.position ?? icon.position,
        order: inputBoxConfig[icon.id]?.order ?? icon.order
      }
    })
    return config
  }, [icons, inputBoxConfig])

  // 获取按位置分组的图标 - 使用 useMemo 缓存结果
  const { leftIcons, rightIcons } = useMemo(() => {
    const getIconsByPosition = (position: 'left' | 'right') => {
      return icons
        .filter((icon) => (localConfig[icon.id]?.position ?? icon.position) === position)
        .sort((a, b) => {
          const orderA = localConfig[a.id]?.order ?? a.order
          const orderB = localConfig[b.id]?.order ?? b.order
          return orderA - orderB
        })
    }

    return {
      leftIcons: getIconsByPosition('left'),
      rightIcons: getIconsByPosition('right')
    }
  }, [icons, localConfig])

  // 更新图标配置
  const updateIconConfig = useCallback(
    (iconId: string, updates: Partial<IconConfig>) => {
      // 保护关键图标不能被隐藏
      if (iconId === 'send_pause' && updates.visible === false) {
        // 可以添加提示消息
        return
      }

      const newConfig = {
        ...localConfig,
        [iconId]: {
          ...localConfig[iconId],
          ...updates
        }
      }
      setInputBoxConfig(newConfig)
    },
    [localConfig, setInputBoxConfig]
  )

  // 处理拖拽结束
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return

      const { source, destination } = result
      const sourcePosition = source.droppableId as 'left' | 'right'
      const destPosition = destination.droppableId as 'left' | 'right'

      const sourceIcons = sourcePosition === 'left' ? leftIcons : rightIcons
      const destIcons = sourcePosition === destPosition ? sourceIcons : destPosition === 'left' ? leftIcons : rightIcons

      const draggedIcon = sourceIcons[source.index]

      // 重新计算顺序
      const newConfig = { ...localConfig }

      if (sourcePosition === destPosition) {
        // 同一位置内重排序
        const reorderedIcons = Array.from(sourceIcons)
        const [removed] = reorderedIcons.splice(source.index, 1)
        reorderedIcons.splice(destination.index, 0, removed)

        reorderedIcons.forEach((icon, index) => {
          newConfig[icon.id] = {
            ...newConfig[icon.id],
            order: index + 1
          }
        })
      } else {
        // 跨位置移动
        const newDestIcons = Array.from(destIcons)
        newDestIcons.splice(destination.index, 0, draggedIcon)

        // 更新目标位置的顺序
        newDestIcons.forEach((icon, index) => {
          newConfig[icon.id] = {
            ...newConfig[icon.id],
            position: destPosition,
            order: index + 1
          }
        })

        // 更新源位置剩余图标的顺序
        const remainingSourceIcons = sourceIcons.filter((icon) => icon.id !== draggedIcon.id)
        remainingSourceIcons.forEach((icon, index) => {
          newConfig[icon.id] = {
            ...newConfig[icon.id],
            order: index + 1
          }
        })
      }

      setInputBoxConfig(newConfig)
    },
    [leftIcons, rightIcons, localConfig, setInputBoxConfig]
  )

  // 重置为默认配置
  const handleReset = useCallback(() => {
    setInputBoxConfig({})
  }, [setInputBoxConfig])

  const renderIconItem = (icon: InputBoxIconInfo, index: number) => {
    const config = localConfig[icon.id]

    return (
      <Draggable key={icon.id} draggableId={icon.id} index={index}>
        {(provided, snapshot) => (
          <IconItem
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            $isDragging={snapshot.isDragging}>
            <IconInfo>
              <DragHandle>
                <GripVertical size={14} />
              </DragHandle>
              <IconPreview>{icon.icon}</IconPreview>
              <IconName>{icon.name}</IconName>
            </IconInfo>
            <IconControls onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
              <Switch
                checked={config?.visible ?? icon.visible}
                onChange={(visible) => updateIconConfig(icon.id, { visible })}
                size="small"
              />
            </IconControls>
          </IconItem>
        )}
      </Draggable>
    )
  }

  return (
    <Container>
      <Header>
        <Title>{t('settings.display.inputbox.icons.title')}</Title>
        <Button onClick={handleReset} size="small">
          {t('common.reset')}
        </Button>
      </Header>

      <DragDropContext onDragEnd={handleDragEnd}>
        <PositionsContainer>
          <PositionSection>
            <PositionTitle>{t('settings.display.inputbox.position.left')}</PositionTitle>
            <Droppable droppableId="left">
              {(provided, snapshot) => (
                <IconsList ref={provided.innerRef} {...provided.droppableProps} $isDragOver={snapshot.isDraggingOver}>
                  {leftIcons.length === 0 ? (
                    <EmptyPlaceholder>{t('settings.display.inputbox.empty.left')}</EmptyPlaceholder>
                  ) : (
                    leftIcons.map((icon, index) => renderIconItem(icon, index))
                  )}
                  {provided.placeholder}
                </IconsList>
              )}
            </Droppable>
          </PositionSection>

          <PositionSection>
            <PositionTitle>{t('settings.display.inputbox.position.right')}</PositionTitle>
            <Droppable droppableId="right">
              {(provided, snapshot) => (
                <IconsList ref={provided.innerRef} {...provided.droppableProps} $isDragOver={snapshot.isDraggingOver}>
                  {rightIcons.length === 0 ? (
                    <EmptyPlaceholder>{t('settings.display.inputbox.empty.right')}</EmptyPlaceholder>
                  ) : (
                    rightIcons.map((icon, index) => renderIconItem(icon, index))
                  )}
                  {provided.placeholder}
                </IconsList>
              )}
            </Droppable>
          </PositionSection>
        </PositionsContainer>
      </DragDropContext>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const Title = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
`

const PositionsContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
`

const PositionSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const PositionTitle = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  font-weight: 500;
`

const IconsList = styled.div<{ $isDragOver?: boolean }>`
  display: flex;
  flex-direction: column;
  min-height: 200px;
  padding: 10px;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow-y: hidden;
  transition: all 0.2s;

  ${(props) =>
    props.$isDragOver &&
    `
    border-color: var(--color-primary);
    background-color: var(--color-primary-bg);
  `}
`

const IconItem = styled.div<{ $isDragging?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin-bottom: 8px;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: move;
  transition: all 0.2s;
  opacity: ${(props) => (props.$isDragging ? 0.9 : 1)};
  transform: ${(props) => (props.$isDragging ? 'rotate(2deg)' : 'none')};

  &:hover {
    border-color: var(--color-primary);
  }
`

const IconInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
`

const DragHandle = styled.div`
  color: var(--color-text-3);
  display: flex;
  align-items: center;
  opacity: 0.6;
  transition: opacity 0.2s;

  ${IconItem}:hover & {
    opacity: 1;
  }
`

const IconPreview = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--color-icon);
`

const IconName = styled.div`
  font-size: 12px;
  color: var(--color-text-1);
`

const IconControls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
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

export default InputBoxIconsManager
