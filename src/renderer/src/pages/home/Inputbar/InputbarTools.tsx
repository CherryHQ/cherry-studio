import '@renderer/pages/home/Inputbar/tools'

import { Tooltip } from '@cherrystudio/ui'
import type { DropResult } from '@hello-pangea/dnd'
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { ActionIconButton } from '@renderer/components/Buttons'
import type { QuickPanelListItem, QuickPanelReservedSymbol } from '@renderer/components/QuickPanel'
import { useQuickPanel } from '@renderer/components/QuickPanel'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useInputbarTools } from '@renderer/pages/home/Inputbar/context/InputbarToolsProvider'
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
import { getToolsForScope } from '@renderer/pages/home/Inputbar/types'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { selectToolOrderForScope, setIsCollapsed, setToolOrder } from '@renderer/store/inputTools'
import type { InputBarToolType } from '@renderer/types/chat'
import { classNames } from '@renderer/utils'
import { Divider, Dropdown } from 'antd'
import type { ItemType } from 'antd/es/menu/interface'
import { Check, CircleChevronRight } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export interface InputbarToolsNewProps {
  scope: InputbarScope
  assistantId: string
  // Session data for Agent Session scope (optional)
  session?: {
    agentId?: string
    sessionId?: string
    slashCommands?: Array<{ command: string; description?: string }>
    tools?: Array<{ id: string; name: string; type: string; description?: string }>
  }
}

interface ToolConfig {
  key: InputBarToolType
  label: string
  tool: ToolDefinition
  visible: boolean
}

const DraggablePortal = ({ children, isDragging }: { children: React.ReactNode; isDragging: boolean }) => {
  return isDragging ? createPortal(children, document.body) : children
}

const InputbarTools = ({ scope, assistantId, session }: InputbarToolsNewProps) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { assistant, model } = useAssistant(assistantId)
  const toolsContext = useInputbarTools()
  const quickPanelContext = useQuickPanel()
  const quickPanelApiCacheRef = useRef(new Map<string, ToolQuickPanelApi>())

  const getQuickPanelApiForTool = useCallback(
    (toolKey: string): ToolQuickPanelApi => {
      const cache = quickPanelApiCacheRef.current

      if (!cache.has(toolKey)) {
        cache.set(toolKey, {
          registerRootMenu: (entries: QuickPanelListItem[]) =>
            toolsContext.toolsRegistry.registerRootMenu(toolKey, entries),
          registerTrigger: (symbol: QuickPanelReservedSymbol, handler: (payload?: unknown) => void) =>
            toolsContext.toolsRegistry.registerTrigger(toolKey, symbol, handler)
        })
      }

      return cache.get(toolKey)!
    },
    [toolsContext.toolsRegistry]
  )

  const reduxToolOrder = useAppSelector((state) => selectToolOrderForScope(state, scope))
  const isCollapse = useAppSelector((state) => state.inputTools.isCollapsed)
  const [targetTool, setTargetTool] = useState<ToolConfig | null>(null)

  // Get tools for current scope
  const availableTools = useMemo(() => {
    return getToolsForScope(scope, { assistant, model, session })
  }, [scope, assistant, model, session])

  // Get tool order for current scope
  const toolOrder = useMemo(() => {
    return reduxToolOrder
  }, [reduxToolOrder])

  // Build render context for tools
  const buildRenderContext = useCallback(
    <S extends readonly ToolStateKey[], A extends readonly ToolActionKey[]>(
      tool: ToolDefinition<S, A>
    ): ToolRenderContext<S, A> => {
      const deps = tool.dependencies
      // 为工具提供完整的 QuickPanel API（注册 + 控制面板）
      const quickPanel = getQuickPanelApiForTool(tool.key)

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
        session,
        state,
        actions,
        quickPanel,
        quickPanelController: quickPanelContext,
        t
      } as ToolRenderContext<S, A>
    },
    [assistant, model, quickPanelContext, scope, session, t, toolsContext, getQuickPanelApiForTool]
  )

  // Build tool metadata (without rendering)
  // Tools with render: null are pure menu contributors and won't appear in UI
  const toolMetadata = useMemo(() => {
    return availableTools.map((tool) => ({
      key: tool.key as InputBarToolType,
      label: typeof tool.label === 'function' ? tool.label(t) : tool.label,
      tool
    }))
  }, [availableTools, t])

  // Declarative tools registration (for tools with quickPanel config)
  // This handles pure menu contributors and trigger handlers
  useEffect(() => {
    const disposeCallbacks: Array<() => void> = []

    for (const tool of availableTools) {
      if (!tool.quickPanel) continue

      const context = buildRenderContext(tool)

      // Register root menu items (declarative)
      if (tool.quickPanel.rootMenu) {
        const menuItems = tool.quickPanel.rootMenu.createMenuItems(context)
        const dispose = toolsContext.toolsRegistry.registerRootMenu(tool.key, menuItems)
        disposeCallbacks.push(dispose)
      }

      // Register triggers (declarative)
      if (tool.quickPanel.triggers) {
        for (const triggerConfig of tool.quickPanel.triggers) {
          const handler = triggerConfig.createHandler(context)
          const dispose = toolsContext.toolsRegistry.registerTrigger(tool.key, triggerConfig.symbol, handler)
          disposeCallbacks.push(dispose)
        }
      }
    }

    return () => {
      disposeCallbacks.forEach((dispose) => dispose())
    }
  }, [availableTools, buildRenderContext, toolsContext.toolsRegistry])

  // Filter visible tools (only those with render functions, not pure menu contributors)
  const visibleTools = useMemo(() => {
    // 1. Get explicitly visible tools from toolOrder
    const explicitlyVisible = toolOrder.visible
      .map((key) => {
        const meta = toolMetadata.find((item) => item.key === key)
        if (!meta || meta.tool.render === null) return null
        return {
          key: meta.key,
          label: meta.label,
          tool: meta.tool,
          visible: true
        }
      })
      .filter(Boolean) as ToolConfig[]

    // 2. Find new tools not in toolOrder (auto-show new tools)
    const knownToolKeys = new Set([...toolOrder.visible, ...toolOrder.hidden])
    const newTools = toolMetadata
      .filter((meta) => !knownToolKeys.has(meta.key) && meta.tool.render !== null)
      .map((meta) => ({
        key: meta.key,
        label: meta.label,
        tool: meta.tool,
        visible: true
      }))

    // 3. Merge: explicit order + new tools at end
    return [...explicitlyVisible, ...newTools]
  }, [toolMetadata, toolOrder.visible, toolOrder.hidden])

  const hiddenTools = useMemo(() => {
    return toolOrder.hidden
      .map((key) => {
        const meta = toolMetadata.find((item) => item.key === key)
        if (!meta || meta.tool.render === null) return null // Filter out pure menu contributors
        return {
          key: meta.key,
          label: meta.label,
          tool: meta.tool,
          visible: false
        }
      })
      .filter(Boolean) as ToolConfig[]
  }, [toolMetadata, toolOrder.hidden])

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

      dispatch(setToolOrder({ scope, toolOrder: newToolOrder }))
      setTargetTool(null)
    },
    [dispatch, scope, toolOrder]
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

    dispatch(setToolOrder({ scope, toolOrder: newToolOrder }))
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

  const managerElements = useMemo(() => {
    return availableTools
      .map((tool) => {
        if (!tool.quickPanelManager) return null
        const Manager = tool.quickPanelManager
        const context = buildRenderContext(tool)
        return <Manager key={`${tool.key}-quick-panel-manager`} context={context} />
      })
      .filter((element): element is React.ReactElement => element !== null)
  }, [availableTools, buildRenderContext])

  return (
    <>
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
                  {visibleTools.map((toolConfig, index) => {
                    const context = buildRenderContext(toolConfig.tool)
                    return (
                      <Draggable key={toolConfig.key} draggableId={toolConfig.key} index={index}>
                        {(provided, snapshot) => (
                          <DraggablePortal isDragging={snapshot.isDragging}>
                            <ToolWrapper
                              data-key={toolConfig.key}
                              onContextMenu={() => setTargetTool(toolConfig)}
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              style={provided.draggableProps.style}>
                              {toolConfig.tool.render?.(context)}
                            </ToolWrapper>
                          </DraggablePortal>
                        )}
                      </Draggable>
                    )
                  })}
                  {provided.placeholder}
                </VisibleTools>
              )}
            </Droppable>

            {showDivider && <Divider type="vertical" style={{ margin: '0 4px' }} />}

            <Droppable droppableId="inputbar-tools-hidden" direction="horizontal">
              {(provided) => (
                <HiddenTools ref={provided.innerRef} {...provided.droppableProps}>
                  {hiddenTools.map((toolConfig, index) => {
                    const context = buildRenderContext(toolConfig.tool)
                    return (
                      <Draggable key={toolConfig.key} draggableId={toolConfig.key} index={index}>
                        {(provided, snapshot) => (
                          <DraggablePortal isDragging={snapshot.isDragging}>
                            <ToolWrapper
                              data-key={toolConfig.key}
                              className={classNames({ 'is-collapsed': isCollapse })}
                              onContextMenu={() => setTargetTool(toolConfig)}
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              style={{
                                ...provided.draggableProps.style,
                                transitionDelay: `${index * 0.02}s`
                              }}>
                              {toolConfig.tool.render?.(context)}
                            </ToolWrapper>
                          </DraggablePortal>
                        )}
                      </Draggable>
                    )
                  })}
                  {provided.placeholder}
                </HiddenTools>
              )}
            </Droppable>
          </DragDropContext>

          {showCollapseButton && (
            <Tooltip content={isCollapse ? t('chat.input.tools.expand') : t('chat.input.tools.collapse')} showArrow>
              <ActionIconButton
                onClick={() => dispatch(setIsCollapsed(!isCollapse))}
                icon={
                  <CircleChevronRight
                    size={18}
                    style={{
                      transform: isCollapse ? 'scaleX(1)' : 'scaleX(-1)'
                    }}
                  />
                }
              />
            </Tooltip>
          )}
        </ToolsContainer>
      </Dropdown>
      {managerElements}
    </>
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
    width: 0;
    margin-right: 0;
    overflow: hidden;
    opacity: 0;
  }
`

export default InputbarTools
