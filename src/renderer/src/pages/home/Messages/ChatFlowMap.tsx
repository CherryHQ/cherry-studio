import '@xyflow/react/dist/style.css'

import { RobotOutlined, UserOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { getModelLogo } from '@renderer/config/models'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { RootState } from '@renderer/store'
import { selectMessagesForTopic } from '@renderer/store/newMessage'
import { Model } from '@renderer/types'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { Controls, Handle, MiniMap, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { Edge, Node, NodeTypes, Position, useEdgesState, useNodesState } from '@xyflow/react'
import { Avatar, Spin, Tooltip } from 'antd'
import { isEqual } from 'lodash'
import { FC, memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'
import styled from 'styled-components'

// 定义Tooltip相关样式组件
const TooltipContent = styled.div`
  max-width: 300px;
`

const TooltipTitle = styled.div`
  font-weight: bold;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 4px;
`

const TooltipBody = styled.div`
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 8px;
  white-space: pre-wrap;
`

const TooltipFooter = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-style: italic;
`

// 自定义节点组件
const CustomNode: FC<{ data: any }> = ({ data }) => {
  const { t } = useTranslation()
  const nodeType = data.type
  let borderColor = 'var(--color-border)'
  let backgroundColor = 'var(--bg-color)'
  let gradientColor = 'rgba(0, 0, 0, 0.03)'
  let userAvatar: React.ReactNode | null = null
  let modelResponses: { model: any; content: string }[] = []

  // 根据消息类型设置不同的样式和图标
  if (nodeType === 'user') {
    borderColor = 'var(--color-icon)'
    backgroundColor = 'rgba(var(--color-info-rgb), 0.03)'
    gradientColor = 'rgba(var(--color-info-rgb), 0.08)'

    // 用户头像
    if (data.userAvatar) {
      userAvatar = <Avatar src={data.userAvatar} size={24} />
    } else {
      userAvatar = <Avatar icon={<UserOutlined />} size={24} style={{ backgroundColor: 'var(--color-info)' }} />
    }

    // 获取相关的模型回复
    if (data.relatedModels && data.relatedModels.length > 0) {
      modelResponses = data.relatedModels.map((model: any) => ({
        model,
        content: model.content || ''
      }))
    }
  }

  // 处理节点点击事件，滚动到对应消息
  const handleNodeClick = () => {
    if (data.messageId) {
      // 创建一个自定义事件来定位消息并切换标签
      const customEvent = new CustomEvent('flow-navigate-to-message', {
        detail: {
          messageId: data.messageId,
          modelId: data.modelId,
          modelName: data.model,
          nodeType: nodeType
        },
        bubbles: true
      })

      // 让监听器处理标签切换
      document.dispatchEvent(customEvent)

      setTimeout(() => {
        EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + data.messageId)
      }, 250)
    }
  }

  // 隐藏连接点的通用样式
  const handleStyle = {
    opacity: 0,
    width: '12px',
    height: '12px',
    background: 'transparent',
    border: 'none'
  }

  return (
    <Tooltip
      title={
        <TooltipContent>
          <TooltipBody>{data.content}</TooltipBody>
          <TooltipFooter>{t('chat.history.click_to_navigate')}</TooltipFooter>
        </TooltipContent>
      }
      placement="top"
      color="rgba(0, 0, 0, 0.85)"
      mouseEnterDelay={0.3}
      mouseLeaveDelay={0.1}
      destroyTooltipOnHide>
      <CustomNodeContainer
        style={{
          borderColor,
          background: `linear-gradient(135deg, ${backgroundColor} 0%, ${gradientColor} 100%)`,
          boxShadow: `0 4px 10px rgba(0, 0, 0, 0.1), 0 0 0 2px ${borderColor}40`
        }}
        onClick={handleNodeClick}>
        <Handle type="target" position={Position.Top} style={handleStyle} isConnectable={false} />
        <Handle type="target" position={Position.Left} style={handleStyle} isConnectable={false} />

        <NodeRow>
          {userAvatar}
          <NodeContent title={data.content}>{data.content}</NodeContent>
        </NodeRow>

        {modelResponses.length > 0 && (
          <>
            <Divider />
            {modelResponses.map((response, index) => (
              <ModelResponseRow key={index}>
                <ModelContent>{response.content}</ModelContent>
                <ModelAvatarsContainer>
                  {response.model.modelInfo ? (
                    <div
                      style={{
                        position: 'absolute',
                        right: `${index * 1}px`,
                        top: `${index * 1}px`,
                        zIndex: modelResponses.length - index
                      }}>
                      <ModelAvatar model={response.model.modelInfo} size={24} />
                    </div>
                  ) : response.model.modelId ? (
                    <Avatar
                      src={getModelLogo(response.model.modelId)}
                      icon={!getModelLogo(response.model.modelId) ? <RobotOutlined /> : undefined}
                      size={24}
                      style={{
                        backgroundColor: 'var(--color-primary)',
                        position: 'absolute',
                        right: `${index * 1}px`,
                        top: `${index * 1}px`,
                        zIndex: modelResponses.length - index
                      }}
                    />
                  ) : null}
                </ModelAvatarsContainer>
              </ModelResponseRow>
            ))}
          </>
        )}

        <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable={false} />
        <Handle type="source" position={Position.Right} style={handleStyle} isConnectable={false} />
      </CustomNodeContainer>
    </Tooltip>
  )
}

// 创建自定义节点类型
const nodeTypes: NodeTypes = { custom: CustomNode }

interface ChatFlowMapProps {
  conversationId?: string
}

// 定义节点和边的类型
type FlowNode = Node<any, string>
type FlowEdge = Edge<any>

// 统一的边样式
const commonEdgeStyle = {
  stroke: 'var(--color-border)',
  strokeDasharray: '4,4',
  strokeWidth: 2
}

// 统一的边配置
const defaultEdgeOptions = {
  animated: true,
  style: commonEdgeStyle,
  type: 'step',
  markerEnd: undefined,
  zIndex: 5
}

const ChatFlowMap: FC<ChatFlowMapProps> = ({ conversationId }) => {
  const { t } = useTranslation()
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([])
  const [loading, setLoading] = useState(true)
  const { userName } = useSettings()
  const { theme } = useTheme()

  const topicId = conversationId

  // 只在消息实际内容变化时更新，而不是属性变化（如foldSelected）
  const messages = useSelector(
    (state: RootState) => selectMessagesForTopic(state, topicId || ''),
    (prev, next) => {
      // 只比较消息的关键属性，忽略展示相关的属性（如foldSelected）
      if (prev.length !== next.length) return false

      // 比较每条消息的内容和关键属性，忽略UI状态相关属性
      return prev.every((prevMsg, index) => {
        const nextMsg = next[index]
        const prevMsgContent = getMainTextContent(prevMsg)
        const nextMsgContent = getMainTextContent(nextMsg)
        return (
          prevMsg.id === nextMsg.id &&
          prevMsgContent === nextMsgContent &&
          prevMsg.role === nextMsg.role &&
          prevMsg.createdAt === nextMsg.createdAt &&
          prevMsg.askId === nextMsg.askId &&
          isEqual(prevMsg.model, nextMsg.model)
        )
      })
    }
  )

  // 获取用户头像
  const userAvatar = useSelector((state: RootState) => state.runtime.avatar)

  // 消息过滤
  const { userMessages, assistantMessages } = useMemo(() => {
    const userMsgs = messages.filter((msg) => msg.role === 'user')
    const assistantMsgs = messages.filter((msg) => msg.role === 'assistant')
    return { userMessages: userMsgs, assistantMessages: assistantMsgs }
  }, [messages])

  const buildConversationFlowData = useCallback(() => {
    if (!topicId || !messages.length) return { nodes: [], edges: [] }

    // 创建节点和边
    const flowNodes: FlowNode[] = []
    const flowEdges: FlowEdge[] = []

    // 布局参数
    const verticalGap = 100 // 用户消息之间的垂直间距
    const baseX = 150

    // 如果没有任何消息可以显示，返回空结果
    if (userMessages.length === 0 && assistantMessages.length === 0) {
      return { nodes: [], edges: [] }
    }

    // 处理孤立消息
    const processedMessages = new Set<string>()

    // 为所有用户消息创建节点
    userMessages.forEach((message, index) => {
      const nodeId = `user-${message.id}`
      const yPosition = index * verticalGap * 2 + 20

      // 获取用户名
      const userNameValue = userName || t('chat.history.user_node')

      // 获取用户头像
      const msgUserAvatar = userAvatar || null

      // 找到用户消息之后的助手回复
      const userMsgTime = new Date(message.createdAt).getTime()
      const relatedAssistantMsgs = assistantMessages.filter((aMsg) => {
        const aMsgTime = new Date(aMsg.createdAt).getTime()
        const isRelated =
          aMsgTime > userMsgTime &&
          (index === userMessages.length - 1 || aMsgTime < new Date(userMessages[index + 1].createdAt).getTime())
        if (isRelated) {
          processedMessages.add(aMsg.id)
        }
        return isRelated
      })

      // 计算当前节点前的所有模型回复数A
      const totalModelResponsesBefore = assistantMessages.filter((aMsg) => {
        const aMsgTime = new Date(aMsg.createdAt).getTime()
        return aMsgTime < userMsgTime
      }).length

      // 计算当前节点前的带回答的提问数B
      const answeredQuestionsBefore = userMessages.slice(0, index).filter((msg) => {
        const msgTime = new Date(msg.createdAt).getTime()
        return assistantMessages.some((aMsg) => {
          const aMsgTime = new Date(aMsg.createdAt).getTime()
          return aMsgTime > msgTime && aMsgTime < userMsgTime
        })
      }).length

      // 计算当前节点前的无回答的提问数C
      const unansweredQuestionsBefore = userMessages.slice(0, index).filter((msg) => {
        const msgTime = new Date(msg.createdAt).getTime()
        return !assistantMessages.some((aMsg) => {
          const aMsgTime = new Date(aMsg.createdAt).getTime()
          return aMsgTime > msgTime && aMsgTime < userMsgTime
        })
      }).length

      // 计算高度补偿
      const heightCompensation = (totalModelResponsesBefore - answeredQuestionsBefore - unansweredQuestionsBefore) * 50

      const adjustedYPosition = yPosition + heightCompensation

      // 准备相关模型信息
      const relatedModels = relatedAssistantMsgs.map((aMsg) => {
        const aMsgAny = aMsg as any
        return {
          modelId: (aMsgAny.model && aMsgAny.model.id) || '',
          modelInfo: aMsgAny.model as Model | undefined,
          content: getMainTextContent(aMsg)
        }
      })

      flowNodes.push({
        id: nodeId,
        type: 'custom',
        data: {
          userName: userNameValue,
          content: getMainTextContent(message),
          type: 'user',
          messageId: message.id,
          userAvatar: msgUserAvatar,
          relatedModels
        },
        position: { x: baseX, y: adjustedYPosition },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top
      })

      // 连接相邻的用户消息
      if (index > 0) {
        const prevUserNodeId = `user-${userMessages[index - 1].id}`
        flowEdges.push({
          id: `edge-${prevUserNodeId}-to-${nodeId}`,
          source: prevUserNodeId,
          target: nodeId
        })
      }
    })

    // 处理剩余的孤立消息（没有对应用户消息的模型回复）
    const orphanAssistantMsgs = assistantMessages.filter((aMsg) => !processedMessages.has(aMsg.id))
    if (orphanAssistantMsgs.length > 0) {
      // 在图表顶部添加这些孤立消息，确保有足够的间距
      const startY = flowNodes.length > 0 ? Math.min(...flowNodes.map((node) => node.position.y)) - verticalGap * 3 : 0

      orphanAssistantMsgs.forEach((aMsg, index) => {
        const nodeId = `orphan-${aMsg.id}`
        const aMsgAny = aMsg as any

        // 获取模型信息
        const modelInfo = aMsgAny.model as Model | undefined
        const modelId = (aMsgAny.model && aMsgAny.model.id) || ''

        // 创建孤立消息节点
        flowNodes.push({
          id: nodeId,
          type: 'custom',
          data: {
            type: 'orphan',
            content: getMainTextContent(aMsg),
            messageId: aMsg.id,
            modelId: modelId,
            modelInfo
          },
          position: {
            x: baseX,
            y: startY + index * verticalGap * 1.5
          },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top
        })

        // 连接孤立消息到最近的用户消息
        if (flowNodes.length > 0) {
          // 找到最近的用户消息节点
          const userNodes = flowNodes.filter((node) => node.data.type === 'user')
          if (userNodes.length > 0) {
            const closestUserNode = userNodes[0] // 由于用户节点是按时间顺序排列的，第一个就是最近的
            flowEdges.push({
              id: `edge-${nodeId}-to-${closestUserNode.id}`,
              source: nodeId,
              target: closestUserNode.id
            })
          }
        }
      })
    }

    return { nodes: flowNodes, edges: flowEdges }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId, messages, userMessages, assistantMessages, t])

  useEffect(() => {
    setLoading(true)
    setTimeout(() => {
      const { nodes: flowNodes, edges: flowEdges } = buildConversationFlowData()
      setNodes([...flowNodes])
      setEdges([...flowEdges])
      setLoading(false)
    }, 500)
  }, [buildConversationFlowData, setNodes, setEdges])

  return (
    <FlowContainer>
      {loading ? (
        <LoadingContainer>
          <Spin size="large" />
        </LoadingContainer>
      ) : nodes.length > 0 ? (
        <ReactFlowProvider>
          <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesFocusable={true}
              zoomOnDoubleClick={true}
              preventScrolling={true}
              elementsSelectable={true}
              selectNodesOnDrag={false}
              nodesFocusable={true}
              zoomOnScroll={true}
              panOnScroll={false}
              minZoom={0.4}
              maxZoom={1}
              defaultEdgeOptions={defaultEdgeOptions}
              fitView={true}
              fitViewOptions={{
                padding: 0.3,
                includeHiddenNodes: false,
                minZoom: 0.4,
                maxZoom: 1
              }}
              proOptions={{ hideAttribution: true }}
              className="react-flow-container"
              colorMode={theme === 'auto' ? 'system' : theme}>
              <Controls showInteractive={false} />
              <MiniMap
                nodeStrokeWidth={3}
                zoomable
                pannable
                nodeColor={(node) => (node.data.type === 'orphan' ? 'var(--color-info)' : 'var(--color-primary)')}
              />
            </ReactFlow>
          </div>
        </ReactFlowProvider>
      ) : (
        <EmptyContainer>
          <EmptyText>{t('chat.history.no_messages')}</EmptyText>
        </EmptyContainer>
      )}
    </FlowContainer>
  )
}

// 样式组件定义
const FlowContainer = styled.div`
  width: 100%;
  height: 100%;
  min-height: 500px;
`

const LoadingContainer = styled.div`
  width: 100%;
  height: 100%;
  min-height: 500px;
  display: flex;
  justify-content: center;
  align-items: center;
`

const EmptyContainer = styled.div`
  width: 100%;
  height: 100%;
  min-height: 500px;
  display: flex;
  justify-content: center;
  align-items: center;
  color: var(--color-text-secondary);
`

const EmptyText = styled.div`
  font-size: 16px;
  margin-bottom: 8px;
  font-weight: bold;
`

const CustomNodeContainer = styled.div`
  padding: 12px;
  border-radius: 10px;
  border: 2px solid;
  width: 280px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease-in-out;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);

  &:hover {
    transform: translateY(-2px);
    box-shadow:
      0 6px 10px rgba(0, 0, 0, 0.1),
      0 0 0 2px ${(props) => props.style?.borderColor || 'var(--color-border)'}80 !important;
    filter: brightness(1.02);
  }

  /* 添加点击动画效果 */
  &:active {
    transform: scale(0.98);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    transition: all 0.1s ease;
  }
`

const NodeContent = styled.div`
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  margin-left: 8px;
`

const NodeRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
`

const Divider = styled.div`
  height: 1px;
  background: var(--color-border);
  margin: 8px 0;
  opacity: 0.5;
`

const ModelResponseRow = styled.div`
  display: flex;
  align-items: flex-start;
  position: relative;
`

const ModelContent = styled.div`
  flex: 1;
  font-size: 14px;
  color: var(--color-text);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
`

const ModelAvatarsContainer = styled.div`
  position: relative;
  width: 24px;
  height: 24px;
  margin-left: 8px;
`

// 确保组件使用React.memo包装以减少不必要的重渲染
export default memo(ChatFlowMap)
