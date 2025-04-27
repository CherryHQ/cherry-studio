import { DialogMap, DialogMapNode } from '@renderer/types'
import { Edge, MarkerType, Node, Position } from '@xyflow/react'
import { TFunction } from 'i18next'

export interface DialogMapNodePosition {
  x: number
  y: number
}

/**
 * 计算节点的层级（深度）
 */
export const calculateNodeLevels = (nodes: Record<string, DialogMapNode>): Record<string, number> => {
  const nodeLevels: Record<string, number> = {}

  // 首先找到没有父节点的节点（根节点）
  const rootNodes = Object.values(nodes).filter((node) => !node.parentId)

  // 从根节点开始，为每个节点分配层级
  const assignLevel = (nodeId: string, level: number) => {
    nodeLevels[nodeId] = level
    const node = nodes[nodeId]
    if (node && node.children.length > 0) {
      node.children.forEach((childId) => {
        assignLevel(childId, level + 1)
      })
    }
  }

  rootNodes.forEach((node) => {
    assignLevel(node.id, 0)
  })

  return nodeLevels
}

/**
 * 查找从根节点到指定节点的祖先路径
 */
export const findAncestors = (dialogMap: DialogMap, nodeId: string, result: string[] = []): string[] => {
  const node = dialogMap.nodes[nodeId]
  if (!node) return result

  result.unshift(nodeId)

  if (node.parentId && dialogMap.nodes[node.parentId]) {
    return findAncestors(dialogMap, node.parentId, result)
  }

  return result
}

/**
 * 查找从指定节点到叶子节点的子孙路径（深度优先）
 */
export const findDescendants = (dialogMap: DialogMap, nodeId: string, result: string[] = []): string[] => {
  const node = dialogMap.nodes[nodeId]
  if (!node) return result

  if (!result.includes(nodeId)) {
    result.push(nodeId)
  }

  if (node.children.length === 0) return result

  // 只跟随第一个子节点的路径
  return findDescendants(dialogMap, node.children[0], result)
}

/**
 * 构建从指定节点到叶子节点的完整路径
 */
export const buildFullPath = (dialogMap: DialogMap, nodeId: string): string[] => {
  // 构建祖先路径
  const ancestors = findAncestors(dialogMap, nodeId)
  const fullPath = [...ancestors]

  // 当前节点不是叶子节点时，添加第一个子路径
  const currentNode = dialogMap.nodes[nodeId]
  if (currentNode && currentNode.children.length > 0) {
    // 去掉已经添加的当前节点
    const descendants = findDescendants(dialogMap, currentNode.children[0])
    fullPath.push(...descendants)
  }

  return fullPath
}

/**
 * 查找选中路径中的所有节点并构建完整路径
 */
export const findPathNodes = (dialogMap: DialogMap, nodeIds: string[]): string[] => {
  const result: string[] = []
  const visited = new Set<string>()

  // 首先找到所有选中的节点
  const selectedNodes = nodeIds.map((id) => dialogMap.nodes[id]).filter(Boolean)

  // 找到最深的选中节点（即离根节点最远的节点）
  const findDeepestNode = (nodes: DialogMapNode[]): DialogMapNode => {
    let deepestNode = nodes[0]
    let maxDepth = 0

    const calculateDepth = (nodeId: string, depth: number = 0): number => {
      const node = dialogMap.nodes[nodeId]
      if (!node || !node.parentId) return depth
      return calculateDepth(node.parentId, depth + 1)
    }

    nodes.forEach((node) => {
      const depth = calculateDepth(node.id)
      if (depth > maxDepth) {
        maxDepth = depth
        deepestNode = node
      }
    })

    return deepestNode
  }

  // 从最深的节点开始，构建完整路径
  const deepestNode = findDeepestNode(selectedNodes)
  let currentNode: DialogMapNode | null = deepestNode

  // 从最深节点向上遍历到根节点
  while (currentNode) {
    if (!visited.has(currentNode.id)) {
      result.unshift(currentNode.id)
      visited.add(currentNode.id)
    }
    currentNode = currentNode.parentId ? dialogMap.nodes[currentNode.parentId] : null
  }

  // 从最深节点向下遍历到叶子节点
  currentNode = deepestNode
  while (currentNode && currentNode.children.length > 0) {
    const nextNode = dialogMap.nodes[currentNode.children[0]]
    if (!nextNode) break
    if (!visited.has(nextNode.id)) {
      result.push(nextNode.id)
      visited.add(nextNode.id)
    }
    currentNode = nextNode
  }

  return result
}

/**
 * 构建对话地图的流程图数据
 */
export const buildDialogMapFlowData = (
  dialogMap: DialogMap,
  t: TFunction<any>,
  handleNodeClick: (nodeId: string) => void,
  handleAddBranch: (nodeId: string) => void,
  handleDeleteNode: (nodeId: string) => void,
  handleNavigateToNode: (nodeId: string) => void
): { nodes: Node[]; edges: Edge[] } => {
  if (!dialogMap) return { nodes: [], edges: [] }

  // 创建节点和边
  const flowNodes: Node[] = []
  const flowEdges: Edge[] = []

  // 节点布局参数 - 垂直布局
  const verticalGap = 220 // 增加垂直间距
  const horizontalGap = 360 // 水平间距
  const initialX = 400 // 初始X位置（居中）
  const initialY = 100 // 初始Y位置
  const maxNodesPerLevel = 4 // 每层最大节点数
  const alternatingOffset = 0.8 // 控制子节点交替偏移的程度

  // 节点尺寸参数（用于碰撞检测）
  const NODE_WIDTH = 240 // 节点宽度
  const NODE_MARGIN = 40 // 节点之间的最小间距

  // 先计算每个节点的层级（深度）
  const nodeLevels = calculateNodeLevels(dialogMap.nodes)

  // 按层级对节点进行分组
  const nodesByLevel: Record<number, string[]> = {}
  Object.entries(nodeLevels).forEach(([nodeId, level]) => {
    if (!nodesByLevel[level]) {
      nodesByLevel[level] = []
    }
    nodesByLevel[level].push(nodeId)
  })

  // 计算节点的X坐标，使同一层级的节点水平排列，但主要分支保持在中央
  const nodePositions: Record<string, DialogMapNodePosition> = {}

  // 第一遍：按照树形结构分配初始位置
  // 逐层计算节点位置，从上到下
  Object.keys(nodesByLevel)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((levelStr) => {
      const level = parseInt(levelStr, 10)
      const nodesInLevel = nodesByLevel[level]

      // 计算本层的Y坐标
      const yPos = initialY + level * verticalGap

      // 处理本层的每个节点
      nodesInLevel.forEach((nodeId, index) => {
        const node = dialogMap.nodes[nodeId]

        // 如果是根节点或第一级，居中排列
        if (level === 0) {
          nodePositions[nodeId] = { x: initialX, y: yPos }
          return
        }

        // 找到父节点并获取其位置
        if (!node.parentId || !nodePositions[node.parentId]) {
          // 没有父节点的位置信息，按索引计算位置
          const xPos = initialX + (index - nodesInLevel.length / 2) * horizontalGap
          nodePositions[nodeId] = { x: xPos, y: yPos }
          return
        }

        // 获取父节点的X坐标
        const parentX = nodePositions[node.parentId].x

        // 获取该节点是父节点的第几个子节点
        const siblingIndex = dialogMap.nodes[node.parentId].children.indexOf(nodeId)
        const siblingCount = dialogMap.nodes[node.parentId].children.length

        // 改进的X位置计算，使子节点更好地围绕父节点分布
        let xOffset = 0
        if (siblingCount > 1) {
          // 为子节点创建更均匀的左右分布
          // 偶数索引的子节点放在右侧，奇数索引的子节点放在左侧
          const direction = siblingIndex % 2 === 0 ? 1 : -1 // 决定子节点在父节点的左侧还是右侧
          const magnitude = Math.floor((siblingIndex + 1) / 2) // 计算偏移量的大小
          const minOffset = NODE_WIDTH + NODE_MARGIN // 最小偏移确保不重叠

          // 计算实际X偏移
          xOffset = direction * magnitude * minOffset * alternatingOffset

          // 如果子节点数量为奇数，确保第一个节点位置居中
          if (siblingCount % 2 === 1 && siblingIndex === 0) {
            xOffset = 0
          }
        }

        // 确保节点不会超出可视区域
        const maxX = initialX + (maxNodesPerLevel * (NODE_WIDTH + NODE_MARGIN)) / 2
        const minX = initialX - (maxNodesPerLevel * (NODE_WIDTH + NODE_MARGIN)) / 2
        const xPos = Math.min(Math.max(parentX + xOffset, minX), maxX)

        nodePositions[nodeId] = {
          x: xPos,
          y: yPos
        }
      })
    })

  // 第二遍：检测并解决节点重叠问题
  // 逐层调整节点位置
  Object.keys(nodesByLevel)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((levelStr) => {
      const level = parseInt(levelStr, 10)
      const nodesInLevel = nodesByLevel[level]

      if (nodesInLevel.length <= 1) return // 只有一个节点不需要调整

      // 按X坐标排序节点
      const sortedNodes = [...nodesInLevel].sort((a, b) => nodePositions[a].x - nodePositions[b].x)

      // 检测并修复重叠
      for (let i = 1; i < sortedNodes.length; i++) {
        const currentNodeId = sortedNodes[i]
        const prevNodeId = sortedNodes[i - 1]
        const currentPos = nodePositions[currentNodeId]
        const prevPos = nodePositions[prevNodeId]

        // 计算当前节点左边缘与前一个节点右边缘之间的距离
        const distance = currentPos.x - prevPos.x
        const minRequiredDistance = NODE_WIDTH + NODE_MARGIN

        // 如果距离小于所需最小距离，向右移动当前节点
        if (distance < minRequiredDistance) {
          const adjustment = minRequiredDistance - distance
          currentPos.x += adjustment

          // 同时递归调整当前节点的所有子节点
          const adjustChildNodes = (nodeId: string, offsetX: number) => {
            const childIds = dialogMap.nodes[nodeId]?.children || []
            childIds.forEach((childId) => {
              if (nodePositions[childId]) {
                nodePositions[childId].x += offsetX
                adjustChildNodes(childId, offsetX)
              }
            })
          }

          adjustChildNodes(currentNodeId, adjustment)
        }
      }

      // 计算本层节点的中心位置
      const leftmostX = nodePositions[sortedNodes[0]].x
      const rightmostX = nodePositions[sortedNodes[sortedNodes.length - 1]].x
      const layerCenter = (leftmostX + rightmostX) / 2
      const desiredCenter = initialX

      // 如果层的中心与期望中心不同，整体移动该层所有节点及其子节点
      if (Math.abs(layerCenter - desiredCenter) > 10) {
        const offsetX = desiredCenter - layerCenter
        sortedNodes.forEach((nodeId) => {
          nodePositions[nodeId].x += offsetX

          // 同时调整所有子节点
          const adjustChildNodes = (nodeId: string, offsetX: number) => {
            const childIds = dialogMap.nodes[nodeId]?.children || []
            childIds.forEach((childId) => {
              if (nodePositions[childId]) {
                nodePositions[childId].x += offsetX
                adjustChildNodes(childId, offsetX)
              }
            })
          }

          adjustChildNodes(nodeId, offsetX)
        })
      }
    })

  // 统一的边样式
  const commonEdgeStyle = {
    stroke: 'var(--color-border-dark, #666)',
    strokeWidth: 3,
    strokeDasharray: '5,3',
    transition: '0.3s ease-in-out'
  }

  // 选中路径的边样式
  const selectedEdgeStyle = {
    stroke: 'var(--color-primary)',
    strokeWidth: 4,
    strokeDasharray: 'none',
    transition: '0.3s ease-in-out'
  }

  // 创建节点
  Object.entries(dialogMap.nodes).forEach(([nodeId, node]) => {
    if (!nodePositions[nodeId]) return

    const { x, y } = nodePositions[nodeId]
    const isSelected = node.isSelected

    flowNodes.push({
      id: nodeId,
      type: 'dialogMapNode',
      data: {
        content: node.content,
        type: node.role,
        nodeId: nodeId,
        messageId: node.messageId,
        isSelected,
        modelId: node.modelId,
        model: node.model?.name || t('dialogMap.unknown_model'),
        modelInfo: node.model,
        onNodeClick: handleNodeClick,
        onAddBranch: handleAddBranch,
        onDeleteNode: handleDeleteNode,
        onNavigateToNode: handleNavigateToNode
      },
      position: { x, y }
    })

    // 创建与子节点的连接
    node.children.forEach((childId) => {
      // 检查是否为选中路径上的连接
      const isSelected = node.isSelected && dialogMap.nodes[childId].isSelected

      // 计算子节点位置与父节点的相对位置，以确定最佳连接点
      const childPosition = nodePositions[childId]
      const parentPosition = nodePositions[nodeId]

      // 默认连接类型
      let sourcePosition = Position.Bottom
      let targetPosition = Position.Top

      // 根据相对位置调整连接点
      if (childPosition && parentPosition) {
        const dx = childPosition.x - parentPosition.x

        // 如果子节点明显在父节点左侧，使用左右连接
        if (dx < -NODE_WIDTH / 2) {
          sourcePosition = Position.Left
          targetPosition = Position.Right
        }
        // 如果子节点明显在父节点右侧，使用右左连接
        else if (dx > NODE_WIDTH / 2) {
          sourcePosition = Position.Right
          targetPosition = Position.Left
        }
        // 否则保持默认的上下连接
      }

      flowEdges.push({
        id: `edge-${nodeId}-to-${childId}`,
        source: nodeId,
        target: childId,
        sourceHandle: null,
        targetHandle: null,
        data: {
          sourcePosition,
          targetPosition,
          isHorizontal: childPosition && parentPosition && Math.abs(childPosition.x - parentPosition.x) > NODE_WIDTH / 2
        },
        animated: isSelected,
        type: 'bezier',
        style: isSelected ? selectedEdgeStyle : commonEdgeStyle,
        markerEnd: isSelected
          ? {
              type: MarkerType.ArrowClosed,
              width: 12,
              height: 12,
              color: 'var(--color-primary)'
            }
          : {
              type: MarkerType.Arrow,
              width: 12,
              height: 12,
              color: 'var(--color-border-dark, #666)'
            }
      })
    })
  })

  return { nodes: flowNodes, edges: flowEdges }
}
