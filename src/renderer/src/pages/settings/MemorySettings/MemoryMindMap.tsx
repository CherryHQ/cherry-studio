import { Memory } from '@renderer/store/memory'
import { applyNodeChanges, Background, Controls, MiniMap, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import { Edge, Node, NodeTypes } from '@xyflow/react'
import { Empty } from 'antd'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import CenterNode from './CenterNode'
import MemoryNode from './MemoryNode'

interface MemoryMindMapProps {
  memories: Memory[]
  onEditMemory: (id: string) => void
  onDeleteMemory: (id: string) => void
}

const MemoryMindMap: React.FC<MemoryMindMapProps> = ({ memories, onEditMemory, onDeleteMemory }) => {
  const { t } = useTranslation()
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  // 处理节点拖动事件
  const onNodesChange = useCallback((changes) => {
    setNodes((nds) => {
      // 中心节点不允许拖动
      const filteredChanges = changes.filter((change) => {
        if (change.type === 'position' && change.id === 'center') {
          return false
        }
        return true
      })
      return applyNodeChanges(filteredChanges, nds)
    })
  }, [])

  // 定义节点类型
  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      memoryNode: MemoryNode,
      centerNode: CenterNode
    }),
    []
  )

  // 转换记忆为节点和边
  useMemo(() => {
    if (memories.length === 0) {
      setNodes([])
      setEdges([])
      return
    }

    // 创建中心节点
    const centerNode: Node = {
      id: 'center',
      type: 'centerNode',
      position: { x: 0, y: 0 },
      data: { label: t('settings.memory.centerNodeLabel') },
      draggable: false // 中心节点不允许拖动
    }

    // 计算合适的半径，确保节点不会太拥挤
    const calculateRadius = () => {
      const baseRadius = 300
      if (memories.length <= 4) return baseRadius
      if (memories.length <= 8) return baseRadius + 50
      return baseRadius + 100
    }

    // 按分类组织记忆
    const categorizedMemories: Record<string, Memory[]> = {}

    // 将记忆分组
    memories.forEach((memory) => {
      const category = memory.category || t('settings.memory.uncategorized')
      if (!categorizedMemories[category]) {
        categorizedMemories[category] = []
      }
      categorizedMemories[category].push(memory)
    })

    // 创建记忆节点和边
    const memoryNodes: Node[] = []
    let categoryIndex = 0
    const categories = Object.keys(categorizedMemories)

    // 为每个分类创建节点
    categories.forEach((category) => {
      const categoryMemories = categorizedMemories[category]
      const categoryAngle = (categoryIndex / categories.length) * 2 * Math.PI
      // const categoryRadius = calculateRadius() * 0.5 // 分类节点距离中心较近

      // 分类内的记忆节点
      categoryMemories.forEach((memory, memIndex) => {
        // 计算节点位置（围绕分类的圆形布局）
        const memAngle = categoryAngle + ((memIndex / categoryMemories.length - 0.5) * Math.PI) / 2
        const memRadius = calculateRadius()
        const x = Math.cos(memAngle) * memRadius
        const y = Math.sin(memAngle) * memRadius

        memoryNodes.push({
          id: memory.id,
          type: 'memoryNode',
          position: { x, y },
          data: {
            memory,
            onEdit: onEditMemory,
            onDelete: onDeleteMemory
          },
          draggable: true
        })
      })

      categoryIndex++
    })

    // 创建从中心到每个记忆的边
    const newEdges: Edge[] = memories.map((memory, index) => {
      // 根据节点位置决定使用哪个连接点
      const angle = (index / memories.length) * 2 * Math.PI
      let sourceHandle = 'b' // 默认使用底部连接点

      if (angle > Math.PI * 0.25 && angle < Math.PI * 0.75) {
        sourceHandle = 't' // 上部
      } else if (angle >= Math.PI * 0.75 && angle < Math.PI * 1.25) {
        sourceHandle = 'r' // 右侧
      } else if (angle >= Math.PI * 1.25 && angle < Math.PI * 1.75) {
        sourceHandle = 'b' // 底部
      } else {
        sourceHandle = 'l' // 左侧
      }

      return {
        id: `center-${memory.id}`,
        source: 'center',
        sourceHandle,
        target: memory.id,
        type: 'smoothstep',
        animated: true
      }
    })

    setNodes([centerNode, ...memoryNodes])
    setEdges(newEdges)
  }, [memories, onEditMemory, onDeleteMemory, t])

  if (memories.length === 0) {
    return <Empty description={t('settings.memory.noMemories')} />
  }

  return (
    <Container>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView
          minZoom={0.5}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          defaultEdgeOptions={{
            animated: true
          }}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}>
          <Controls position="bottom-left" />
          <MiniMap
            nodeColor={(node) => {
              return node.id === 'center' ? '#1890ff' : '#91d5ff'
            }}
          />
          <Background color="#aaa" gap={16} />
        </ReactFlow>
      </ReactFlowProvider>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  height: 100%;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  position: relative;

  /* 只增强选中的连接线样式 */
  .react-flow__edge.selected {
    .react-flow__edge-path {
      stroke: #f5222d !important;
      stroke-width: 4px !important;
    }
  }

  /* 正常连接线样式 */
  .react-flow__edge:not(.selected) {
    .react-flow__edge-path {
      stroke: #1890ff;
      stroke-width: 1.5px;
      stroke-dasharray: none;
    }
  }

  /* 鼠标悬停在节点上时的样式 */
  .react-flow__node:hover {
    cursor: move;
  }

  /* 控制按钮样式 */
  .react-flow__controls {
    bottom: 10px;
    left: 10px;
    top: auto;
  }
`

export default MemoryMindMap
