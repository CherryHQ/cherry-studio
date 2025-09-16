import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { loggerService } from '@logger'
import { ActionIconButton } from '@renderer/components/Buttons'
import { QuickPanelListItem } from '@renderer/components/QuickPanel'
import {
  isGeminiModel,
  isGenerateImageModel,
  isMandatoryWebSearchModel,
  isSupportedReasoningEffortModel,
  isSupportedThinkingTokenModel,
  isVisionModel
} from '@renderer/config/models'
import { isSupportUrlContextProvider } from '@renderer/config/providers'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useShortcutDisplay } from '@renderer/hooks/useShortcuts'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setIsCollapsed, setToolOrder } from '@renderer/store/inputTools'
import { FileType, FileTypes, KnowledgeBase, Model } from '@renderer/types'
import { classNames } from '@renderer/utils'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/mcp-tools'
import { Divider, Dropdown, Tooltip } from 'antd'
import { ItemType } from 'antd/es/menu/interface'
import {
  AtSign,
  Check,
  CircleChevronRight,
  FileSearch,
  Globe,
  Hammer,
  Languages,
  Link,
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
import KnowledgeBaseButton, { KnowledgeBaseButtonRef } from './KnowledgeBaseButton'
import MCPToolsButton, { MCPToolsButtonRef } from './MCPToolsButton'
import MentionModelsButton, { MentionModelsButtonRef } from './MentionModelsButton'
import NewContextButton from './NewContextButton'
import QuickPhrasesButton, { QuickPhrasesButtonRef } from './QuickPhrasesButton'
import ThinkingButton, { ThinkingButtonRef } from './ThinkingButton'
import UrlContextButton, { UrlContextButtonRef } from './UrlContextbutton'
import WebSearchButton, { WebSearchButtonRef } from './WebSearchButton'

const logger = loggerService.withContext('InputbarTools')

export interface InputbarToolsRef {
  getQuickPanelMenu: (params: { text: string; translate: () => void }) => QuickPanelListItem[]
  openMentionModelsPanel: (triggerInfo?: { type: 'input' | 'button'; position?: number; originalText?: string }) => void
  openAttachmentQuickPanel: () => void
}

export interface InputbarToolsProps {
  assistantId: string
  model: Model
  files: FileType[]
  setFiles: Dispatch<SetStateAction<FileType[]>>
  extensions: string[]
  setText: Dispatch<SetStateAction<string>>
  resizeTextArea: () => void
  selectedKnowledgeBases: KnowledgeBase[]
  setSelectedKnowledgeBases: Dispatch<SetStateAction<KnowledgeBase[]>>
  mentionedModels: Model[]
  setMentionedModels: Dispatch<SetStateAction<Model[]>>
  couldAddImageFile: boolean
  isExpanded: boolean
  onToggleExpanded: () => void

  addNewTopic: () => void
  clearTopic: () => void
  onNewContext: () => void
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
  assistantId,
  model,
  files,
  setFiles,
  setText,
  resizeTextArea,
  selectedKnowledgeBases,
  setSelectedKnowledgeBases,
  mentionedModels,
  setMentionedModels,
  couldAddImageFile,
  isExpanded: isExpended,
  onToggleExpanded: onToggleExpended,
  addNewTopic,
  clearTopic,
  onNewContext,
  extensions
}: InputbarToolsProps & { ref?: React.RefObject<InputbarToolsRef | null> }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { assistant, updateAssistant } = useAssistant(assistantId)

  const quickPhrasesButtonRef = useRef<QuickPhrasesButtonRef>(null)
  const mentionModelsButtonRef = useRef<MentionModelsButtonRef>(null)
  const knowledgeBaseButtonRef = useRef<KnowledgeBaseButtonRef>(null)
  const mcpToolsButtonRef = useRef<MCPToolsButtonRef>(null)
  const attachmentButtonRef = useRef<AttachmentButtonRef>(null)
  const webSearchButtonRef = useRef<WebSearchButtonRef | null>(null)
  const thinkingButtonRef = useRef<ThinkingButtonRef | null>(null)
  const urlContextButtonRef = useRef<UrlContextButtonRef | null>(null)

  const toolOrder = useAppSelector((state) => state.inputTools.toolOrder)
  const isCollapse = useAppSelector((state) => state.inputTools.isCollapsed)

  const [targetTool, setTargetTool] = useState<ToolButtonConfig | null>(null)

  const showThinkingButton = useMemo(
    () => isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model),
    [model]
  )

  const showMcpServerButton = useMemo(() => isSupportedToolUse(assistant) || isPromptToolUse(assistant), [assistant])

  const knowledgeSidebarEnabled = useSidebarIconShow('knowledge')
  const showKnowledgeBaseButton = knowledgeSidebarEnabled && showMcpServerButton

  const handleKnowledgeBaseSelect = useCallback(
    (bases?: KnowledgeBase[]) => {
      updateAssistant({ knowledge_bases: bases })
      setSelectedKnowledgeBases(bases ?? [])
    },
    [setSelectedKnowledgeBases, updateAssistant]
  )

  // 仅允许在不含图片文件时mention非视觉模型
  const couldMentionNotVisionModel = useMemo(() => {
    return !files.some((file) => file.type === FileTypes.IMAGE)
  }, [files])

  const onMentionModel = useCallback(
    (model: Model) => {
      // 我想应该没有模型是只支持视觉而不支持文本的？
      if (isVisionModel(model) || couldMentionNotVisionModel) {
        setMentionedModels((prev) => {
          const modelId = getModelUniqId(model)
          const exists = prev.some((m) => getModelUniqId(m) === modelId)
          return exists ? prev.filter((m) => getModelUniqId(m) !== modelId) : [...prev, model]
        })
      } else {
        logger.error('Cannot add non-vision model when images are uploaded')
      }
    },
    [couldMentionNotVisionModel, setMentionedModels]
  )

  const onClearMentionModels = useCallback(() => setMentionedModels([]), [setMentionedModels])

  const onEnableGenerateImage = useCallback(() => {
    updateAssistant({ enableGenerateImage: !assistant.enableGenerateImage })
  }, [assistant.enableGenerateImage, updateAssistant])

  const newTopicShortcut = useShortcutDisplay('new_topic')
  const clearTopicShortcut = useShortcutDisplay('clear_topic')

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

  const getQuickPanelMenuImpl = (params: { text: string; translate: () => void }): QuickPanelListItem[] => {
    const { text, translate } = params

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
        icon: <Hammer />,
        isMenu: true,
        action: () => {
          mcpToolsButtonRef.current?.openQuickPanel()
        }
      },
      {
        label: `MCP ${t('settings.mcp.tabs.prompts')}`,
        description: '',
        icon: <Hammer />,
        isMenu: true,
        action: () => {
          mcpToolsButtonRef.current?.openPromptList()
        }
      },
      {
        label: `MCP ${t('settings.mcp.tabs.resources')}`,
        description: '',
        icon: <Hammer />,
        isMenu: true,
        action: () => {
          mcpToolsButtonRef.current?.openResourcesList()
        }
      },
      {
        label: t('chat.input.web_search.label'),
        description: '',
        icon: <Globe />,
        isMenu: true,
        action: () => {
          webSearchButtonRef.current?.openQuickPanel()
        }
      },
      {
        label: t('chat.input.url_context'),
        description: '',
        icon: <Link />,
        isMenu: true,
        action: () => {
          urlContextButtonRef.current?.openQuickPanel()
        }
      },
      {
        label: couldAddImageFile ? t('chat.input.upload.attachment') : t('chat.input.upload.document'),
        description: '',
        icon: <Paperclip />,
        isMenu: true,
        action: () => {
          attachmentButtonRef.current?.openQuickPanel()
        }
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
    openMentionModelsPanel: (triggerInfo) => mentionModelsButtonRef.current?.openQuickPanel(triggerInfo),
    openAttachmentQuickPanel: () => attachmentButtonRef.current?.openQuickPanel()
  }))

  const toolButtons = useMemo<ToolButtonConfig[]>(() => {
    return [
      {
        key: 'new_topic',
        label: t('chat.input.new_topic', { Command: '' }),
        component: (
          <Tooltip
            placement="top"
            title={t('chat.input.new_topic', { Command: newTopicShortcut })}
            mouseLeaveDelay={0}
            arrow>
            <ActionIconButton onClick={addNewTopic}>
              <MessageSquareDiff size={19} />
            </ActionIconButton>
          </Tooltip>
        )
      },
      {
        key: 'attachment',
        label: t('chat.input.upload.image_or_document'),
        component: (
          <AttachmentButton
            ref={attachmentButtonRef}
            couldAddImageFile={couldAddImageFile}
            extensions={extensions}
            files={files}
            setFiles={setFiles}
          />
        )
      },
      {
        key: 'thinking',
        label: t('chat.input.thinking.label'),
        component: <ThinkingButton ref={thinkingButtonRef} model={model} assistantId={assistant.id} />,
        condition: showThinkingButton
      },
      {
        key: 'web_search',
        label: t('chat.input.web_search.label'),
        component: <WebSearchButton ref={webSearchButtonRef} assistantId={assistant.id} />,
        condition: !isMandatoryWebSearchModel(model)
      },
      {
        key: 'url_context',
        label: t('chat.input.url_context'),
        component: <UrlContextButton ref={urlContextButtonRef} assistantId={assistant.id} />,
        condition: isGeminiModel(model) && isSupportUrlContextProvider(getProviderByModel(model))
      },
      {
        key: 'knowledge_base',
        label: t('chat.input.knowledge_base'),
        component: (
          <KnowledgeBaseButton
            ref={knowledgeBaseButtonRef}
            selectedBases={selectedKnowledgeBases}
            onSelect={handleKnowledgeBaseSelect}
            disabled={files.length > 0}
          />
        ),
        condition: showKnowledgeBaseButton
      },
      {
        key: 'mcp_tools',
        label: t('settings.mcp.title'),
        component: (
          <MCPToolsButton
            assistantId={assistant.id}
            ref={mcpToolsButtonRef}
            setInputValue={setText}
            resizeTextArea={resizeTextArea}
          />
        ),
        condition: showMcpServerButton
      },
      {
        key: 'generate_image',
        label: t('chat.input.generate_image'),
        component: (
          <GenerateImageButton model={model} assistant={assistant} onEnableGenerateImage={onEnableGenerateImage} />
        ),
        condition: isGenerateImageModel(model)
      },
      {
        key: 'mention_models',
        label: t('agents.edit.model.select.title'),
        component: (
          <MentionModelsButton
            ref={mentionModelsButtonRef}
            mentionedModels={mentionedModels}
            onMentionModel={onMentionModel}
            onClearMentionModels={onClearMentionModels}
            couldMentionNotVisionModel={couldMentionNotVisionModel}
            files={files}
            setText={setText}
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
            assistantId={assistant.id}
          />
        )
      },
      {
        key: 'clear_topic',
        label: t('chat.input.clear.label', { Command: '' }),
        component: (
          <Tooltip
            placement="top"
            title={t('chat.input.clear.label', { Command: clearTopicShortcut })}
            mouseLeaveDelay={0}
            arrow>
            <ActionIconButton onClick={clearTopic}>
              <PaintbrushVertical size={18} />
            </ActionIconButton>
          </Tooltip>
        )
      },
      {
        key: 'toggle_expand',
        label: isExpended ? t('chat.input.collapse') : t('chat.input.expand'),
        component: (
          <Tooltip
            placement="top"
            title={isExpended ? t('chat.input.collapse') : t('chat.input.expand')}
            mouseLeaveDelay={0}
            arrow>
            <ActionIconButton onClick={onToggleExpended}>
              {isExpended ? <Minimize size={18} /> : <Maximize size={18} />}
            </ActionIconButton>
          </Tooltip>
        )
      },
      {
        key: 'new_context',
        label: t('chat.input.new.context', { Command: '' }),
        component: <NewContextButton onNewContext={onNewContext} />
      }
    ]
  }, [
    addNewTopic,
    assistant,
    clearTopicShortcut,
    clearTopic,
    couldAddImageFile,
    couldMentionNotVisionModel,
    extensions,
    files,
    handleKnowledgeBaseSelect,
    isExpended,
    mentionedModels,
    model,
    newTopicShortcut,
    onClearMentionModels,
    onEnableGenerateImage,
    onMentionModel,
    onNewContext,
    onToggleExpended,
    resizeTextArea,
    selectedKnowledgeBases,
    setFiles,
    setText,
    showKnowledgeBaseButton,
    showMcpServerButton,
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
            <ActionIconButton onClick={() => dispatch(setIsCollapsed(!isCollapse))}>
              <CircleChevronRight
                size={18}
                style={{
                  transform: isCollapse ? 'scaleX(1)' : 'scaleX(-1)'
                }}
              />
            </ActionIconButton>
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
