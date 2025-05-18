import '@xyflow/react/dist/style.css'

import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import DialogMapService from '@renderer/services/DialogMapService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { useAppDispatch } from '@renderer/store'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { DialogMap as DialogMapType, Topic } from '@renderer/types'
import { buildDialogMapFlowData } from '@renderer/utils/dialogMapUtils'
import { BezierEdge, Controls, MiniMap, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { EdgeTypes, NodeTypes, useEdgesState, useNodesState } from '@xyflow/react'
import { Button, Empty, Modal, Spin } from 'antd'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import DialogMapNode from './DialogMapNode'

// 创建自定义节点类型
const nodeTypes: NodeTypes = { dialogMapNode: DialogMapNode }

// 添加边缘类型
const edgeTypes: EdgeTypes = { bezier: BezierEdge }

interface DialogMapProps {
  topic: Topic
  onClose: () => void
}

// 统一的边配置
const defaultEdgeOptions = {
  animated: true,
  type: 'bezier',
  zIndex: 5
}

interface CollapsedNodesState {
  [topicId: string]: string[]
}

// 主对话地图组件
const DialogMap: FC<DialogMapProps> = ({ topic, onClose }) => {
  const { t } = useTranslation()
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([])
  const [loading, setLoading] = useState(true)
  const [dialogMap, setDialogMap] = useState<DialogMapType | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set())
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const dialogMapRef = useRef<DialogMapType | null>(null)

  useEffect(() => {
    dialogMapRef.current = dialogMap
  }, [dialogMap])

  // 加载对话地图数据
  const loadDialogMap = useCallback(async () => {
    if (!topic) return

    setLoading(true)
    try {
      // 获取主题的最新消息
      const currentTopic = await db.topics.get(topic.id)
      if (!currentTopic) {
        throw new Error(`Topic with id ${topic.id} not found`)
      }

      // 获取所有消息ID作为新的路径
      const newPath = currentTopic.messages.map((msg) => msg.id)

      // 获取或创建对话地图
      let map = await DialogMapService.createDialogMapFromTopic(topic.id)

      // 更新对话地图，合并新的路径
      map = await DialogMapService.updateDialogMap(topic.id, newPath)

      // 获取当前选中的路径
      const currentSelectedPath = map.selectedPath || []

      // 确保根节点是用户的第一个提问
      const rootNode = Object.values(map.nodes).find((node) => !node.parentId)

      if (rootNode && rootNode.role !== 'user') {
        // 如果不是用户消息，找到第一个用户消息作为根节点
        const firstUserNode = Object.values(map.nodes).find((node) => node.role === 'user')

        if (firstUserNode) {
          // 更新根节点关系
          map.rootNodeId = firstUserNode.id
          firstUserNode.parentId = null
          // 更新其他节点的父节点关系
          Object.values(map.nodes).forEach((node) => {
            if (node.id !== firstUserNode.id && node.parentId === rootNode.id) {
              node.parentId = firstUserNode.id
              firstUserNode.children.push(node.id)
            }
          })
          // 删除原来的根节点
          delete map.nodes[rootNode.id]
        }
      } else if (rootNode) {
        // 确保 rootNodeId 与实际根节点一致
        map.rootNodeId = rootNode.id
      }

      // 更新节点的选中状态，只选中当前路径上的节点
      Object.values(map.nodes).forEach((node) => {
        node.isSelected = currentSelectedPath.includes(node.id)
      })

      setDialogMap(map)
      setSelectedNodeIds(currentSelectedPath)
    } catch (error) {
      console.error('Failed to load dialog map:', error)
    } finally {
      setLoading(false)
    }
  }, [topic])

  // 监听消息更新事件
  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.MESSAGES_UPDATED, async (data: { topicId: string }) => {
      if (data.topicId === topic.id) {
        // 重新加载对话地图
        await loadDialogMap()
      }
    })

    return () => unsubscribe()
  }, [topic.id, loadDialogMap])

  // 每次打开地图时重新加载数据
  useEffect(() => {
    if (topic) {
      loadDialogMap()
    }
  }, [topic, loadDialogMap])

  // 处理节点折叠/展开
  const handleToggleCollapse = useCallback((nodeId: string, isCollapsed: boolean) => {
    setCollapsedNodes((prev) => {
      const newSet = new Set(prev)
      if (isCollapsed) {
        newSet.add(nodeId)
      } else {
        newSet.delete(nodeId)
      }
      return newSet
    })
  }, [])

  // 加载保存的折叠状态
  useEffect(() => {
    const loadCollapsedState = async () => {
      try {
        const savedState = (await db.settings.where('id').equals('dialogMapCollapsedNodes').first()) as
          | { value: CollapsedNodesState }
          | undefined
        if (savedState?.value && savedState.value[topic.id]) {
          setCollapsedNodes(new Set(savedState.value[topic.id]))
        } else {
          // 如果没有保存的状态，重置为空集合
          setCollapsedNodes(new Set())
        }
      } catch (error) {
        console.error('Failed to load collapsed state:', error)
        // 发生错误时也重置为空集合
        setCollapsedNodes(new Set())
      }
    }
    // 每次加载对话地图时都重新加载折叠状态
    if (!loading && dialogMap) {
      loadCollapsedState()
    }
  }, [topic.id, loading, dialogMap])

  // 保存折叠状态
  useEffect(() => {
    const saveCollapsedState = async () => {
      try {
        const savedState = (await db.settings.where('id').equals('dialogMapCollapsedNodes').first()) as
          | { value: CollapsedNodesState }
          | undefined
        const newState = {
          id: 'dialogMapCollapsedNodes',
          value: {
            ...(savedState?.value || {}),
            [topic.id]: Array.from(collapsedNodes)
          }
        }
        await db.settings.put(newState)
      } catch (error) {
        console.error('Failed to save collapsed state:', error)
      }
    }
    // 只有在对话地图加载完成后才保存折叠状态，移除对collapsedNodes.size的检查，确保空集合也会被保存
    if (!loading && dialogMap) {
      saveCollapsedState()
    }
  }, [collapsedNodes, topic.id, loading, dialogMap])

  // 处理节点点击，更新选择的路径
  const handleNodeClick = useCallback(
    async (nodeId: string) => {
      if (!dialogMap) return

      try {
        // 使用工具函数构建完整路径
        const fullPath = await DialogMapService.getNodeFullPath(dialogMap.id, nodeId)

        // 更新服务层中的选中路径
        const updatedMap = await DialogMapService.setSelectedPath(dialogMap.id, fullPath)

        // 更新本地状态
        setSelectedNodeIds(fullPath)
        setDialogMap(updatedMap)
      } catch (error) {
        console.error('Failed to handle node click:', error)
      }
    },
    [dialogMap]
  )

  // 添加处理新分支的函数
  const handleAddBranch = useCallback(
    async (nodeId: string) => {
      if (!dialogMap) return

      try {
        // 使用服务层方法处理分支创建
        const ancestors = await DialogMapService.notifyBranchCreation(dialogMap.id, nodeId)

        // 根据选中的路径生成消息列表
        const messages = await DialogMapService.generateMessagesFromPath(dialogMap, ancestors)

        // 更新当前对话的消息
        dispatch(newMessagesActions.messagesReceived({ topicId: topic.id, messages }))

        // 发送事件通知消息已更新
        EventEmitter.emit(EVENT_NAMES.MESSAGES_UPDATED, { topicId: topic.id })

        // 关闭对话地图窗口
        onClose()
      } catch (error) {
        console.error('Failed to handle add branch:', error)
      }
    },
    [dialogMap, topic, dispatch, onClose]
  )

  // 处理删除节点
  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      if (!dialogMap) return

      try {
        // 调用服务删除节点及其子节点
        const updatedMap = await DialogMapService.deleteNodeAndDescendants(dialogMap.id, nodeId)

        // 更新状态
        setDialogMap(updatedMap)
        setSelectedNodeIds(updatedMap.selectedPath)

        // 如果删除后选择了新的路径，则更新对话
        if (updatedMap.selectedPath && updatedMap.selectedPath.length > 0) {
          // 根据选中的路径生成消息列表
          const messages = await DialogMapService.generateMessagesFromPath(updatedMap, updatedMap.selectedPath)

          // 更新当前对话的消息
          dispatch(newMessagesActions.messagesReceived({ topicId: topic.id, messages }))

          // 发送事件通知消息已更新
          EventEmitter.emit(EVENT_NAMES.MESSAGES_UPDATED, { topicId: topic.id })
        }
      } catch (error) {
        console.error('Failed to delete node:', error)
        Modal.error({
          title: t('dialogMap.delete_node_error'),
          content: String(error)
        })
      }
    },
    [dialogMap, topic, dispatch, t]
  )

  // 处理跳转到节点的功能
  const handleNavigateToNode = useCallback(
    async (nodeId: string) => {
      if (!dialogMap || !topic) return

      try {
        // 获取节点
        const node = dialogMap.nodes[nodeId]
        if (!node || !node.messageId) return

        // 检查节点是否在当前选中的path中
        const isInSelectedPath = node.isSelected

        // 如果不在当前选中的path中，先切换path
        if (!isInSelectedPath) {
          // 使用工具函数获取完整路径
          const fullPath = await DialogMapService.getNodeFullPath(dialogMap.id, nodeId)

          // 处理路径变更并生成新消息
          const messages = await DialogMapService.processPathChangeAndGenerateMessages(dialogMap.id, fullPath)

          // 更新当前对话的消息
          dispatch(newMessagesActions.messagesReceived({ topicId: topic.id, messages }))

          // 发送事件通知消息已更新
          EventEmitter.emit(EVENT_NAMES.MESSAGES_UPDATED, { topicId: topic.id })
        }

        // 发送LOCATE_MESSAGE事件，定位到消息
        EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + node.messageId)

        // 关闭对话地图
        onClose()
      } catch (error) {
        console.error('Failed to navigate to node:', error)
      }
    },
    [dialogMap, topic, dispatch, onClose]
  )

  // 当对话地图数据变化时，更新流程图
  useEffect(() => {
    if (!loading && dialogMap) {
      const flowData = buildDialogMapFlowData(
        dialogMap,
        t,
        handleNodeClick,
        handleAddBranch,
        handleDeleteNode,
        handleNavigateToNode,
        collapsedNodes,
        handleToggleCollapse
      )
      setNodes(flowData.nodes)
      setEdges(flowData.edges)
    }
  }, [
    loading,
    dialogMap,
    t,
    handleNodeClick,
    handleAddBranch,
    handleDeleteNode,
    handleNavigateToNode,
    collapsedNodes,
    handleToggleCollapse,
    setNodes,
    setEdges
  ])

  // 应用选中的路径生成新的对话
  const applySelectedPath = useCallback(async () => {
    if (!dialogMap || !topic) return

    try {
      // 查找并应用最佳路径
      const updatedMap = await DialogMapService.findAndApplyOptimalPath(dialogMap.id, selectedNodeIds)

      // 根据完整的路径生成消息列表
      const messages = await DialogMapService.generateMessagesFromPath(updatedMap, updatedMap.selectedPath)

      // 更新当前对话的消息
      dispatch(newMessagesActions.messagesReceived({ topicId: topic.id, messages }))

      // 发送事件通知消息已更新
      EventEmitter.emit(EVENT_NAMES.MESSAGES_UPDATED, { topicId: topic.id })

      // 关闭对话地图
      onClose()
    } catch (error) {
      console.error('Failed to apply selected path:', error)
    }
  }, [dialogMap, selectedNodeIds, topic, dispatch, onClose])

  return (
    <FlowContainer>
      <ActionButtons>
        <Button type="primary" onClick={applySelectedPath} disabled={!dialogMap || selectedNodeIds.length === 0}>
          {t('dialogMap.apply_selected_path')}
        </Button>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
      </ActionButtons>

      {loading ? (
        <LoadingContainer>
          <Spin size="large" />
        </LoadingContainer>
      ) : dialogMap && nodes.length > 0 ? (
        <ReactFlowProvider>
          <div style={{ width: '100%', height: 'calc(100% - 50px)' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesFocusable={true}
              zoomOnDoubleClick={false}
              preventScrolling={true}
              elementsSelectable={true}
              selectNodesOnDrag={false}
              nodesFocusable={true}
              zoomOnScroll={true}
              panOnScroll={true}
              minZoom={0.4}
              maxZoom={2}
              defaultEdgeOptions={defaultEdgeOptions}
              fitView={true}
              fitViewOptions={{
                padding: 0.4,
                includeHiddenNodes: false,
                minZoom: 0.3,
                maxZoom: 2
              }}
              proOptions={{ hideAttribution: true }}
              className="react-flow-container"
              colorMode={theme === 'auto' ? 'system' : theme}>
              <Controls showInteractive={false} />
              <MiniMap
                nodeStrokeWidth={3}
                zoomable
                pannable
                nodeColor={(node) => {
                  if (node.data.isSelected) return 'var(--color-primary)'
                  return node.data.type === 'user' ? 'var(--color-link)' : 'var(--color-black-mute)'
                }}
              />
            </ReactFlow>
          </div>
        </ReactFlowProvider>
      ) : (
        <EmptyContainer>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<EmptyText>{t('dialogMap.no_conversation')}</EmptyText>}
          />
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
  position: relative;
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

const ActionButtons = styled.div`
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 10;
  display: flex;
  gap: 8px;
`

export default DialogMap
