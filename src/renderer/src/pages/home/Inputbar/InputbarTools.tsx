import '@renderer/pages/home/Inputbar/tools'

import type { DropResult } from '@hello-pangea/dnd'
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { ActionIconButton } from '@renderer/components/Buttons'
import { MdiLightbulbOn } from '@renderer/components/Icons'
import type { QuickPanelListItem, QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useInputbarTools } from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
import { getInputbarConfig } from '@renderer/pages/home/Inputbar/registry'
import type {
  InputbarScope,
  ToolActionKey,
  ToolActionMap,
  ToolDefinition,
  ToolOrderConfig,
  ToolQuickPanelApi,
  ToolRenderContext,
  ToolStateKey,
  ToolStateMap
} from '@renderer/pages/home/Inputbar/types'
import { getDefaultToolOrder, getToolsForScope } from '@renderer/pages/home/Inputbar/types'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setIsCollapsed, setToolOrder } from '@renderer/store/inputTools'
import type { InputBarToolType } from '@renderer/types/chat'
import { classNames } from '@renderer/utils'
import { Divider, Dropdown } from 'antd'
import type { ItemType } from 'antd/es/menu/interface'
import { Check, CircleChevronRight } from 'lucide-react'
import React, { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export interface InputbarToolsNewProps {
  scope: InputbarScope
  assistantId: string
}

interface ToolButtonConfig {
  key: InputBarToolType
  component: React.ReactNode
  condition?: boolean
  visible?: boolean
  label?: string
  icon?: React.ReactNode
  tool?: ToolDefinition
}

const DraggablePortal = ({ children, isDragging }: { children: React.ReactNode; isDragging: boolean }) => {
  return isDragging ? createPortal(children, document.body) : children
}

// Component to render tool buttons outside of useMemo
const ToolButton = React.memo(
  ({
    tool,
    context
  }: {
    tool: ToolDefinition
    context: ToolRenderContext<readonly ToolStateKey[], readonly ToolActionKey[]>
  }) => {
    return <>{tool.render(context)}</>
  },
  (prevProps, nextProps) => {
    // Only re-render if tool key changes
    return prevProps.tool.key === nextProps.tool.key
  }
)

const InputbarTools = ({ scope, assistantId }: InputbarToolsNewProps) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { assistant, model } = useAssistant(assistantId)
  const toolsContext = useInputbarTools()
  const features = useMemo(() => getInputbarConfig(scope).features, [scope])

  const toolOrder = useAppSelector((state) => state.inputTools.toolOrder) || getDefaultToolOrder(scope)
  const isCollapse = useAppSelector((state) => state.inputTools.isCollapsed)
  const [targetTool, setTargetTool] = useState<ToolButtonConfig | null>(null)

  // Get tools for current scope
  const availableTools = useMemo(() => {
    return getToolsForScope(scope, { assistant, model, features })
  }, [scope, assistant, model, features])

  // Build render context for tools
  const buildRenderContext = useCallback(
    <S extends readonly ToolStateKey[], A extends readonly ToolActionKey[]>(
      tool: ToolDefinition<S, A>
    ): ToolRenderContext<S, A> => {
      const deps = tool.dependencies
      // 为工具按钮提供 QuickPanel API（只包含注册功能）
      const quickPanel: ToolQuickPanelApi = {
        registerRootMenu: (entries: QuickPanelListItem[]) =>
          toolsContext.toolsRegistry.registerRootMenu(tool.key, entries),
        registerTrigger: (symbol: QuickPanelReservedSymbol, handler: (payload?: unknown) => void) =>
          toolsContext.toolsRegistry.registerTrigger(tool.key, symbol, handler)
      }

      const state = (deps?.state || ([] as unknown as S)).reduce(
        (acc, key) => {
          acc[key] = toolsContext[key]
          return acc
        },
        {} as Pick<ToolStateMap, S[number]>
      )

      const actions = (deps?.actions || ([] as unknown as A)).reduce(
        (acc, key) => {
          const actionValue = toolsContext[key]
          if (actionValue) {
            acc[key] = actionValue
          }
          return acc
        },
        {} as Pick<ToolActionMap, A[number]>
      )

      return {
        scope,
        assistant,
        model,
        features,
        state,
        actions,
        quickPanel,
        t
      }
    },
    [assistant, features, model, scope, t, toolsContext]
  )

  // Convert tools to button configs
  const toolButtons = useMemo<ToolButtonConfig[]>(() => {
    return availableTools.map((tool) => ({
      key: tool.key as InputBarToolType,
      label: typeof tool.label === 'function' ? tool.label(t) : tool.label,
      component: null, // Will be rendered later
      condition: true, // Already filtered by getToolsForScope
      tool // Store the tool definition for later rendering
    }))
  }, [availableTools, t])

  const visibleTools = useMemo(() => {
    return toolOrder.visible
      .map((key) => {
        const tool = toolButtons.find((item) => item.key === key)
        if (!tool) return null
        return {
          ...tool,
          visible: true
        }
      })
      .filter(Boolean) as ToolButtonConfig[]
  }, [toolButtons, toolOrder.visible])

  const hiddenTools = useMemo(() => {
    return toolOrder.hidden
      .map((key) => {
        const tool = toolButtons.find((item) => item.key === key)
        if (!tool) return null
        return {
          ...tool,
          visible: false
        }
      })
      .filter(Boolean) as ToolButtonConfig[]
  }, [toolButtons, toolOrder.hidden])

  const showDivider = useMemo(() => {
    return hiddenTools.length > 0 && visibleTools.length > 0
  }, [hiddenTools, visibleTools])

  const showCollapseButton = useMemo(() => {
    return hiddenTools.length > 0
  }, [hiddenTools])

  const toggleToolVisibility = useCallback(
    (toolKey: InputBarToolType, isVisible: boolean | undefined) => {
      const newToolOrder: ToolOrderConfig = {
        visible: [...toolOrder.visible],
        hidden: [...toolOrder.hidden]
      }

      if (isVisible === true) {
        newToolOrder.visible = newToolOrder.visible.filter((key) => key !== toolKey)
        newToolOrder.hidden.push(toolKey)
      } else {
        newToolOrder.hidden = newToolOrder.hidden.filter((key) => key !== toolKey)
        newToolOrder.visible.push(toolKey)
      }

      dispatch(setToolOrder(newToolOrder))
      setTargetTool(null)
    },
    [dispatch, toolOrder]
  )

  const handleDragEnd = (result: DropResult) => {
    const { source, destination } = result
    if (!destination) return

    const sourceId = source.droppableId
    const destinationId = destination.droppableId

    const newToolOrder: ToolOrderConfig = {
      visible: [...toolOrder.visible],
      hidden: [...toolOrder.hidden]
    }

    const sourceArray = sourceId === 'inputbar-tools-visible' ? 'visible' : 'hidden'
    const destArray = destinationId === 'inputbar-tools-visible' ? 'visible' : 'hidden'

    if (sourceArray === destArray) {
      const items = newToolOrder[sourceArray]
      const [removed] = items.splice(source.index, 1)
      items.splice(destination.index, 0, removed)
    } else {
      const removed = newToolOrder[sourceArray][source.index]
      newToolOrder[sourceArray].splice(source.index, 1)
      newToolOrder[destArray].splice(destination.index, 0, removed)
    }

    dispatch(setToolOrder(newToolOrder))
  }

  const getMenuItems = useMemo(() => {
    const baseItems: ItemType[] = [...visibleTools, ...hiddenTools].map((tool) => ({
      label: tool.label,
      key: tool.key,
      icon: (
        <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {tool.visible ? <Check size={16} /> : undefined}
        </div>
      ),
      onClick: () => toggleToolVisibility(tool.key, tool.visible)
    }))

    if (targetTool) {
      baseItems.push({ type: 'divider' })
      baseItems.push({
        label: `${targetTool.visible ? t('chat.input.tools.collapse_in') : t('chat.input.tools.collapse_out')} "${targetTool.label}"`,
        key: 'selected_' + targetTool.key,
        icon: <div style={{ width: 20, height: 20 }}></div>,
        onClick: () => toggleToolVisibility(targetTool.key, targetTool.visible)
      })
    }

    return baseItems
  }, [hiddenTools, t, targetTool, toggleToolVisibility, visibleTools])

  return (
    <Dropdown menu={{ items: getMenuItems }} trigger={['contextMenu']}>
      <ToolsContainer
        onContextMenu={(e) => {
          const target = e.target as HTMLElement
          const isToolButton = target.closest('[data-key]')
          if (!isToolButton) {
            setTargetTool(null)
          }
        }}>
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="inputbar-tools-visible" direction="horizontal">
            {(provided) => (
              <VisibleTools ref={provided.innerRef} {...provided.droppableProps}>
                {visibleTools.map((tool, index) => (
                  <Draggable key={tool.key} draggableId={tool.key} index={index}>
                    {(provided, snapshot) => (
                      <DraggablePortal isDragging={snapshot.isDragging}>
                        <ToolWrapper
                          data-key={tool.key}
                          onContextMenu={() => setTargetTool(tool)}
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          style={provided.draggableProps.style}>
                          {tool.tool ? (
                            <ToolButton tool={tool.tool} context={buildRenderContext(tool.tool)} />
                          ) : (
                            tool.component
                          )}
                        </ToolWrapper>
                      </DraggablePortal>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </VisibleTools>
            )}
          </Droppable>

          {showDivider && <Divider type="vertical" style={{ margin: '0 4px' }} />}

          <Droppable droppableId="inputbar-tools-hidden" direction="horizontal">
            {(provided) => (
              <HiddenTools ref={provided.innerRef} {...provided.droppableProps}>
                {hiddenTools.map((tool, index) => (
                  <Draggable key={tool.key} draggableId={tool.key} index={index}>
                    {(provided, snapshot) => (
                      <DraggablePortal isDragging={snapshot.isDragging}>
                        <ToolWrapper
                          data-key={tool.key}
                          className={classNames({ 'is-collapsed': isCollapse })}
                          onContextMenu={() => setTargetTool(tool)}
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          style={{
                            ...provided.draggableProps.style,
                            transitionDelay: `${index * 0.02}s`
                          }}>
                          {tool.tool ? (
                            <ToolButton tool={tool.tool} context={buildRenderContext(tool.tool)} />
                          ) : (
                            tool.component
                          )}
                        </ToolWrapper>
                      </DraggablePortal>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </HiddenTools>
            )}
          </Droppable>
        </DragDropContext>

        {showCollapseButton && (
          <ActionIconButton
            onClick={() => dispatch(setIsCollapsed(!isCollapse))}
            title={isCollapse ? t('chat.input.tools.expand') : t('chat.input.tools.collapse')}>
            <CircleChevronRight size={18} style={{ transform: isCollapse ? 'scaleX(1)' : 'scaleX(-1)' }} />
          </ActionIconButton>
        )}
      </ToolsContainer>
    </Dropdown>
  )
}

InputbarTools.displayName = 'InputbarTools'

const ToolsContainer = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  position: relative;
`

const VisibleTools = styled.div`
  height: 30px;
  display: flex;
  align-items: center;
  overflow-x: auto;
  &::-webkit-scrollbar {
    display: none;
  }
  -ms-overflow-style: none;
  scrollbar-width: none;
`

const HiddenTools = styled.div`
  height: 30px;
  display: flex;
  align-items: center;
  overflow-x: auto;
  &::-webkit-scrollbar {
    display: none;
  }
  -ms-overflow-style: none;
  scrollbar-width: none;
`

const ToolWrapper = styled.div`
  width: 30px;
  margin-right: 6px;
  transition:
    width 0.2s,
    margin-right 0.2s,
    opacity 0.2s;
  &.is-collapsed {
    width: 0px;
    margin-right: 0px;
    overflow: hidden;
    opacity: 0;
  }
`

export default InputbarTools
