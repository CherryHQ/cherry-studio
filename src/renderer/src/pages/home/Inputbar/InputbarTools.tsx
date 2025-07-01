import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { QuickPanelListItem } from '@renderer/components/QuickPanel'
import { isGenerateImageModel } from '@renderer/config/models'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setIsCollapsed, setToolOrder } from '@renderer/store/inputTools'
import { Assistant, FileType, KnowledgeBase, Model } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { Divider, Dropdown, Tooltip } from 'antd'
import { ItemType } from 'antd/es/menu/interface'
import {
  AtSign,
  Check,
  CircleChevronRight,
  FileSearch,
  Globe,
  Languages,
  LucideSquareTerminal,
  Maximize,
  MessageSquareDiff,
  Minimize,
  PaintbrushVertical,
  Paperclip,
  Zap
} from 'lucide-react'
import { Dispatch, ReactNode, SetStateAction, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AttachmentButton, { AttachmentButtonRef } from './AttachmentButton'
import GenerateImageButton from './GenerateImageButton'
import { ToolbarButton } from './Inputbar'
import KnowledgeBaseButton, { KnowledgeBaseButtonRef } from './KnowledgeBaseButton'
import MCPToolsButton, { MCPToolsButtonRef } from './MCPToolsButton'
import MentionModelsButton, { MentionModelsButtonRef } from './MentionModelsButton'
import NewContextButton from './NewContextButton'
import QuickPhrasesButton, { QuickPhrasesButtonRef } from './QuickPhrasesButton'
import ThinkingButton, { ThinkingButtonRef } from './ThinkingButton'
import WebSearchButton, { WebSearchButtonRef } from './WebSearchButton'

export interface InputbarToolsRef {
  getQuickPanelMenu: (params: {
    t: (key: string, options?: any) => string
    files: FileType[]
    couldAddImageFile: boolean
    text: string
    openSelectFileMenu: () => void
    translate: () => void
  }) => QuickPanelListItem[]
  openMentionModelsPanel: () => void
  openAttachmentQuickPanel: () => void
}

export interface InputbarToolsProps {
  assistant: Assistant
  model: Model
  files: FileType[]
  setFiles: (files: FileType[]) => void
  extensions: string[]
  showThinkingButton: boolean
  showKnowledgeIcon: boolean
  selectedKnowledgeBases: KnowledgeBase[]
  handleKnowledgeBaseSelect: (bases?: KnowledgeBase[]) => void
  setText: Dispatch<SetStateAction<string>>
  resizeTextArea: () => void
  mentionModels: Model[]
  onMentionModel: (model: Model) => void
  couldMentionNotVisionModel: boolean
  couldAddImageFile: boolean
  onEnableGenerateImage: () => void
  isExpended: boolean
  onToggleExpended: () => void

  addNewTopic: () => void
  clearTopic: () => void
  onNewContext: () => void

  newTopicShortcut: string
  cleanTopicShortcut: string
}

interface ToolButtonConfig {
  key: string
  component: ReactNode
  condition?: boolean
  visible?: boolean
  label?: string
  icon?: ReactNode
}

const DraggablePortal = ({ children, isDragging }) => {
  return isDragging ? createPortal(children, document.body) : children
}

const InputbarTools = ({
  ref,
  assistant,
  model,
  files,
  setFiles,
  showThinkingButton,
  showKnowledgeIcon,
  selectedKnowledgeBases,
  handleKnowledgeBaseSelect,
  setText,
  resizeTextArea,
  mentionModels,
  onMentionModel,
  couldMentionNotVisionModel,
  couldAddImageFile,
  onEnableGenerateImage,
  isExpended,
  onToggleExpended,
  addNewTopic,
  clearTopic,
  onNewContext,
  newTopicShortcut,
  cleanTopicShortcut,
  extensions
}: InputbarToolsProps & { ref?: React.RefObject<InputbarToolsRef | null> }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const quickPhrasesButtonRef = useRef<QuickPhrasesButtonRef>(null)
  const mentionModelsButtonRef = useRef<MentionModelsButtonRef>(null)
  const knowledgeBaseButtonRef = useRef<KnowledgeBaseButtonRef>(null)
  const mcpToolsButtonRef = useRef<MCPToolsButtonRef>(null)
  const attachmentButtonRef = useRef<AttachmentButtonRef>(null)
  const webSearchButtonRef = useRef<WebSearchButtonRef | null>(null)
  const thinkingButtonRef = useRef<ThinkingButtonRef | null>(null)

  const toolOrder = useAppSelector((state) => state.inputTools.toolOrder)
  const isCollapse = useAppSelector((state) => state.inputTools.isCollapsed)

  const [targetTool, setTargetTool] = useState<ToolButtonConfig | null>(null)

  const toggleToolVisibility = useCallback(
    (toolKey: string, isVisible: boolean | undefined) => {
      const newToolOrder = {
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
    [dispatch, toolOrder.hidden, toolOrder.visible]
  )

  const getQuickPanelMenuImpl = (params: {
    t: (key: string, options?: any) => string
    files: FileType[]
    couldAddImageFile: boolean
    text: string
    openSelectFileMenu: () => void
    translate: () => void
  }): QuickPanelListItem[] => {
    const { t, files, couldAddImageFile, text, openSelectFileMenu, translate } = params

    return [
      {
        label: t('settings.quickPhrase.title'),
        description: '',
        icon: <Zap />,
        isMenu: true,
        action: () => {
          quickPhrasesButtonRef.current?.openQuickPanel()
        }
      },
      {
        label: t('agents.edit.model.select.title'),
        description: '',
        icon: <AtSign />,
        isMenu: true,
        action: () => {
          mentionModelsButtonRef.current?.openQuickPanel()
        }
      },
      {
        label: t('chat.input.knowledge_base'),
        description: '',
        icon: <FileSearch />,
        isMenu: true,
        disabled: files.length > 0,
        action: () => {
          knowledgeBaseButtonRef.current?.openQuickPanel()
        }
      },
      {
        label: t('settings.mcp.title'),
        description: t('settings.mcp.not_support'),
        icon: <LucideSquareTerminal />,
        isMenu: true,
        action: () => {
          mcpToolsButtonRef.current?.openQuickPanel()
        }
      },
      {
        label: `MCP ${t('settings.mcp.tabs.prompts')}`,
        description: '',
        icon: <LucideSquareTerminal />,
        isMenu: true,
        action: () => {
          mcpToolsButtonRef.current?.openPromptList()
        }
      },
      {
        label: `MCP ${t('settings.mcp.tabs.resources')}`,
        description: '',
        icon: <LucideSquareTerminal />,
        isMenu: true,
        action: () => {
          mcpToolsButtonRef.current?.openResourcesList()
        }
      },
      {
        label: t('chat.input.web_search'),
        description: '',
        icon: <Globe />,
        isMenu: true,
        action: () => {
          webSearchButtonRef.current?.openQuickPanel()
        }
      },
      {
        label: couldAddImageFile ? t('chat.input.upload') : t('chat.input.upload.document'),
        description: '',
        icon: <Paperclip />,
        isMenu: true,
        action: openSelectFileMenu
      },
      {
        label: t('translate.title'),
        description: t('translate.menu.description'),
        icon: <Languages />,
        action: () => {
          if (!text) return
          translate()
        }
      }
    ]
  }

  const handleDragEnd = (result: DropResult) => {
    const { source, destination } = result

    if (!destination) return

    const sourceId = source.droppableId
    const destinationId = destination.droppableId

    const newToolOrder = {
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

  useImperativeHandle(ref, () => ({
    getQuickPanelMenu: getQuickPanelMenuImpl,
    openMentionModelsPanel: () => mentionModelsButtonRef.current?.openQuickPanel(),
    openAttachmentQuickPanel: () => attachmentButtonRef.current?.openQuickPanel()
  }))

  const toolButtons = useMemo<ToolButtonConfig[]>(() => {
    return [
      {
        key: 'new_topic',
        label: t('chat.input.new_topic', { Command: '' }),
        component: (
          <Tooltip placement="top" title={t('chat.input.new_topic', { Command: newTopicShortcut })} arrow>
            <ToolbarButton type="text" onClick={addNewTopic}>
              <MessageSquareDiff size={19} />
            </ToolbarButton>
          </Tooltip>
        )
      },
      {
        key: 'attachment',
        label: t('chat.input.upload'),
        component: (
          <AttachmentButton
            ref={attachmentButtonRef}
            couldAddImageFile={couldAddImageFile}
            extensions={extensions}
            files={files}
            setFiles={setFiles}
            ToolbarButton={ToolbarButton}
          />
        )
      },
      {
        key: 'thinking',
        label: t('chat.input.thinking'),
        component: (
          <ThinkingButton ref={thinkingButtonRef} model={model} assistant={assistant} ToolbarButton={ToolbarButton} />
        ),
        condition: showThinkingButton
      },
      {
        key: 'web_search',
        label: t('chat.input.web_search'),
        component: <WebSearchButton ref={webSearchButtonRef} assistant={assistant} ToolbarButton={ToolbarButton} />
      },
      {
        key: 'knowledge_base',
        label: t('chat.input.knowledge_base'),
        component: (
          <KnowledgeBaseButton
            ref={knowledgeBaseButtonRef}
            selectedBases={selectedKnowledgeBases}
            onSelect={handleKnowledgeBaseSelect}
            ToolbarButton={ToolbarButton}
            disabled={files.length > 0}
          />
        ),
        condition: showKnowledgeIcon
      },
      {
        key: 'mcp_tools',
        label: t('settings.mcp.title'),
        component: (
          <MCPToolsButton
            assistant={assistant}
            ref={mcpToolsButtonRef}
            ToolbarButton={ToolbarButton}
            setInputValue={setText}
            resizeTextArea={resizeTextArea}
          />
        )
      },
      {
        key: 'generate_image',
        label: t('chat.input.generate_image'),
        component: (
          <GenerateImageButton
            model={model}
            assistant={assistant}
            onEnableGenerateImage={onEnableGenerateImage}
            ToolbarButton={ToolbarButton}
          />
        ),
        condition: isGenerateImageModel(model)
      },
      {
        key: 'mention_models',
        label: t('agents.edit.model.select.title'),
        component: (
          <MentionModelsButton
            ref={mentionModelsButtonRef}
            mentionedModels={mentionModels}
            onMentionModel={onMentionModel}
            ToolbarButton={ToolbarButton}
            couldMentionNotVisionModel={couldMentionNotVisionModel}
            files={files}
          />
        )
      },
      {
        key: 'quick_phrases',
        label: t('settings.quickPhrase.title'),
        component: (
          <QuickPhrasesButton
            ref={quickPhrasesButtonRef}
            setInputValue={setText}
            resizeTextArea={resizeTextArea}
            ToolbarButton={ToolbarButton}
            assistantObj={assistant}
          />
        )
      },
      {
        key: 'clear_topic',
        label: t('chat.input.clear', { Command: '' }),
        component: (
          <Tooltip placement="top" title={t('chat.input.clear', { Command: cleanTopicShortcut })} arrow>
            <ToolbarButton type="text" onClick={clearTopic}>
              <PaintbrushVertical size={18} />
            </ToolbarButton>
          </Tooltip>
        )
      },
      {
        key: 'toggle_expand',
        label: isExpended ? t('chat.input.collapse') : t('chat.input.expand'),
        component: (
          <Tooltip placement="top" title={isExpended ? t('chat.input.collapse') : t('chat.input.expand')} arrow>
            <ToolbarButton type="text" onClick={onToggleExpended}>
              {isExpended ? <Minimize size={18} /> : <Maximize size={18} />}
            </ToolbarButton>
          </Tooltip>
        )
      },
      {
        key: 'new_context',
        label: t('chat.input.new.context', { Command: '' }),
        component: <NewContextButton onNewContext={onNewContext} ToolbarButton={ToolbarButton} />
      }
    ]
  }, [
    addNewTopic,
    assistant,
    cleanTopicShortcut,
    clearTopic,
    couldAddImageFile,
    couldMentionNotVisionModel,
    extensions,
    files,
    handleKnowledgeBaseSelect,
    isExpended,
    mentionModels,
    model,
    newTopicShortcut,
    onEnableGenerateImage,
    onMentionModel,
    onNewContext,
    onToggleExpended,
    resizeTextArea,
    selectedKnowledgeBases,
    setFiles,
    setText,
    showKnowledgeIcon,
    showThinkingButton,
    t
  ])

  const visibleTools = useMemo(() => {
    return toolOrder.visible.map((v) => ({
      ...toolButtons.find((tool) => tool.key === v),
      visible: true
    })) as ToolButtonConfig[]
  }, [toolButtons, toolOrder])

  const hiddenTools = useMemo(() => {
    return toolOrder.hidden.map((v) => ({
      ...toolButtons.find((tool) => tool.key === v),
      visible: false
    })) as ToolButtonConfig[]
  }, [toolButtons, toolOrder])

  const showDivider = useMemo(() => {
    return (
      hiddenTools.filter((tool) => tool.condition ?? true).length > 0 &&
      visibleTools.filter((tool) => tool.condition ?? true).length !== 0
    )
  }, [hiddenTools, visibleTools])

  const showCollapseButton = useMemo(() => {
    return hiddenTools.filter((tool) => tool.condition ?? true).length > 0
  }, [hiddenTools])

  const getMenuItems = useMemo(() => {
    const baseItems: ItemType[] = [...visibleTools, ...hiddenTools].map((tool) => ({
      label: tool.label,
      key: tool.key,
      icon: (
        <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {tool.visible ? <Check size={16} /> : undefined}
        </div>
      ),
      onClick: () => {
        toggleToolVisibility(tool.key, tool.visible)
      }
    }))

    if (targetTool) {
      baseItems.push({
        type: 'divider'
      })
      baseItems.push({
        label: `${targetTool.visible ? t('chat.input.tools.collapse_in') : t('chat.input.tools.collapse_out')} "${targetTool.label}"`,
        key: 'selected_' + targetTool.key,
        icon: <div style={{ width: 20, height: 20 }}></div>,
        onClick: () => {
          toggleToolVisibility(targetTool.key, targetTool.visible)
        }
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
                {visibleTools.map(
                  (tool, index) =>
                    (tool.condition ?? true) && (
                      <Draggable key={tool.key} draggableId={tool.key} index={index}>
                        {(provided, snapshot) => (
                          <DraggablePortal isDragging={snapshot.isDragging}>
                            <ToolWrapper
                              data-key={tool.key}
                              onContextMenu={() => setTargetTool(tool)}
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              style={{
                                ...provided.draggableProps.style
                              }}>
                              {tool.component}
                            </ToolWrapper>
                          </DraggablePortal>
                        )}
                      </Draggable>
                    )
                )}

                {provided.placeholder}
              </VisibleTools>
            )}
          </Droppable>

          {showDivider && <Divider type="vertical" style={{ margin: '0 4px' }} />}

          <Droppable droppableId="inputbar-tools-hidden" direction="horizontal">
            {(provided) => (
              <HiddenTools ref={provided.innerRef} {...provided.droppableProps}>
                {hiddenTools.map(
                  (tool, index) =>
                    (tool.condition ?? true) && (
                      <Draggable key={tool.key} draggableId={tool.key} index={index}>
                        {(provided, snapshot) => (
                          <DraggablePortal isDragging={snapshot.isDragging}>
                            <ToolWrapper
                              data-key={tool.key}
                              className={classNames({
                                'is-collapsed': isCollapse
                              })}
                              onContextMenu={() => setTargetTool(tool)}
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              style={{
                                ...provided.draggableProps.style,
                                transitionDelay: `${index * 0.02}s`
                              }}>
                              {tool.component}
                            </ToolWrapper>
                          </DraggablePortal>
                        )}
                      </Draggable>
                    )
                )}
                {provided.placeholder}
              </HiddenTools>
            )}
          </Droppable>
        </DragDropContext>

        {showCollapseButton && (
          <Tooltip
            placement="top"
            title={isCollapse ? t('chat.input.tools.expand') : t('chat.input.tools.collapse')}
            arrow>
            <ToolbarButton type="text" onClick={() => dispatch(setIsCollapsed(!isCollapse))}>
              <CircleChevronRight
                size={18}
                style={{
                  transform: isCollapse ? 'scaleX(1)' : 'scaleX(-1)'
                }}
              />
            </ToolbarButton>
          </Tooltip>
        )}
      </ToolsContainer>
    </Dropdown>
  )
}

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
