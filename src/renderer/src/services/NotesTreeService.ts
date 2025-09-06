import { loggerService } from '@logger'
import db from '@renderer/databases'
import { NotesTreeNode } from '@renderer/types/note'

const MARKDOWN_EXT = '.md'
const NOTES_TREE_ID = 'notes-tree-structure'

const logger = loggerService.withContext('NotesTreeService')

/**
 * 获取树结构
 */
export const getNotesTree = async (): Promise<NotesTreeNode[]> => {
  const record = await db.notes_tree.get(NOTES_TREE_ID)
  return record?.tree || []
}

/**
 * 在树中插入节点
 */
export async function insertNodeIntoTree(
  tree: NotesTreeNode[],
  node: NotesTreeNode,
  parentId?: string
): Promise<NotesTreeNode[]> {
  try {
    if (!parentId) {
      tree.push(node)
    } else {
      const parent = findNodeInTree(tree, parentId)
      if (parent && parent.type === 'folder') {
        if (!parent.children) {
          parent.children = []
        }
        parent.children.push(node)
      }
    }

    await db.notes_tree.put({ id: NOTES_TREE_ID, tree })
    return tree
  } catch (error) {
    logger.error('Failed to insert node into tree:', error as Error)
    throw error
  }
}

/**
 * 从树中删除节点
 */
export async function removeNodeFromTree(tree: NotesTreeNode[], nodeId: string): Promise<boolean> {
  const removed = removeNodeFromTreeInMemory(tree, nodeId)
  if (removed) {
    await db.notes_tree.put({ id: NOTES_TREE_ID, tree })
  }
  return removed
}

/**
 * 从树中删除节点（仅在内存中操作，不保存数据库）
 */
function removeNodeFromTreeInMemory(tree: NotesTreeNode[], nodeId: string): boolean {
  for (let i = 0; i < tree.length; i++) {
    if (tree[i].id === nodeId) {
      tree.splice(i, 1)
      return true
    }
    if (tree[i].children) {
      const removed = removeNodeFromTreeInMemory(tree[i].children!, nodeId)
      if (removed) {
        return true
      }
    }
  }
  return false
}

export async function moveNodeInTree(
  tree: NotesTreeNode[],
  sourceNodeId: string,
  targetNodeId: string,
  position: 'before' | 'after' | 'inside'
): Promise<boolean> {
  try {
    const sourceNode = findNodeInTree(tree, sourceNodeId)
    const targetNode = findNodeInTree(tree, targetNodeId)

    if (!sourceNode || !targetNode) {
      logger.error(`Move nodes in tree failed: node not found (source: ${sourceNodeId}, target: ${targetNodeId})`)
      return false
    }

    // 在移除节点之前先获取源节点的父节点信息，用于后续判断是否为同级排序
    const sourceParent = findParentNode(tree, sourceNodeId)
    const targetParent = findParentNode(tree, targetNodeId)

    // 从原位置移除节点（不保存数据库，只在内存中操作）
    const removed = removeNodeFromTreeInMemory(tree, sourceNodeId)
    if (!removed) {
      logger.error('Move nodes in tree failed: could not remove source node')
      return false
    }

    try {
      // 根据位置进行放置
      if (position === 'inside' && targetNode.type === 'folder') {
        if (!targetNode.children) {
          targetNode.children = []
        }
        targetNode.children.push(sourceNode)
        targetNode.expanded = true

        sourceNode.treePath = `${targetNode.treePath}/${sourceNode.name}`
      } else {
        const targetList = targetParent ? targetParent.children! : tree
        const targetIndex = targetList.findIndex((node) => node.id === targetNodeId)

        if (targetIndex === -1) {
          logger.error('Move nodes in tree failed: target position not found')
          return false
        }

        // 根据position确定插入位置
        const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
        targetList.splice(insertIndex, 0, sourceNode)

        // 检查是否为同级排序，如果是则保持原有的 treePath
        const isSameLevelReorder = sourceParent === targetParent

        // 只有在跨级移动时才更新节点路径
        if (!isSameLevelReorder) {
          if (targetParent) {
            sourceNode.treePath = `${targetParent.treePath}/${sourceNode.name}`
          } else {
            sourceNode.treePath = `/${sourceNode.name}`
          }
        }
      }

      // 更新修改时间
      sourceNode.updatedAt = new Date().toISOString()

      // 只有在所有操作成功后才保存到数据库
      await db.notes_tree.put({ id: NOTES_TREE_ID, tree })

      return true
    } catch (error) {
      logger.error('Move nodes in tree failed during placement, attempting to restore:', error as Error)
      // 如果放置失败，尝试恢复原始节点到原位置
      // 这里需要重新实现恢复逻辑，暂时返回false
      return false
    }
  } catch (error) {
    logger.error('Move nodes in tree failed:', error as Error)
    return false
  }
}

/**
 * 重命名节点
 */
export async function renameNodeFromTree(
  tree: NotesTreeNode[],
  nodeId: string,
  newName: string
): Promise<NotesTreeNode> {
  const node = findNodeInTree(tree, nodeId)

  if (!node) {
    throw new Error('Node not found')
  }

  node.name = newName

  const dirPath = node.treePath.substring(0, node.treePath.lastIndexOf('/') + 1)
  node.treePath = dirPath + newName

  const externalDirPath = node.externalPath.substring(0, node.externalPath.lastIndexOf('/') + 1)
  node.externalPath = node.type === 'file' ? externalDirPath + newName + MARKDOWN_EXT : externalDirPath + newName

  node.updatedAt = new Date().toISOString()
  await db.notes_tree.put({ id: NOTES_TREE_ID, tree })
  return node
}

/**
 * 修改节点键值
 */
export async function updateNodeInTree(
  tree: NotesTreeNode[],
  nodeId: string,
  updates: Partial<NotesTreeNode>
): Promise<NotesTreeNode> {
  const node = findNodeInTree(tree, nodeId)
  if (!node) {
    throw new Error('Node not found')
  }

  Object.assign(node, updates)
  node.updatedAt = new Date().toISOString()
  await db.notes_tree.put({ id: NOTES_TREE_ID, tree })

  return node
}

/**
 * 在树中查找节点
 */
export function findNodeInTree(tree: NotesTreeNode[], nodeId: string): NotesTreeNode | null {
  for (const node of tree) {
    if (node.id === nodeId) {
      return node
    }
    if (node.children) {
      const found = findNodeInTree(node.children, nodeId)
      if (found) {
        return found
      }
    }
  }
  return null
}

/**
 * 根据路径查找节点
 */
export function findNodeByPath(tree: NotesTreeNode[], path: string): NotesTreeNode | null {
  for (const node of tree) {
    if (node.treePath === path) {
      return node
    }
    if (node.children) {
      const found = findNodeByPath(node.children, path)
      if (found) {
        return found
      }
    }
  }
  return null
}

// ---
// 辅助函数
// ---

/**
 * 查找节点的父节点
 */
export function findParentNode(tree: NotesTreeNode[], targetNodeId: string): NotesTreeNode | null {
  for (const node of tree) {
    if (node.children) {
      const isDirectChild = node.children.some((child) => child.id === targetNodeId)
      if (isDirectChild) {
        return node
      }

      const parent = findParentNode(node.children, targetNodeId)
      if (parent) {
        return parent
      }
    }
  }
  return null
}

/**
 * 判断节点是否为另一个节点的父节点
 */
export function isParentNode(tree: NotesTreeNode[], parentId: string, childId: string): boolean {
  const childNode = findNodeInTree(tree, childId)
  if (!childNode) {
    return false
  }

  const parentNode = findNodeInTree(tree, parentId)
  if (!parentNode || parentNode.type !== 'folder' || !parentNode.children) {
    return false
  }

  if (parentNode.children.some((child) => child.id === childId)) {
    return true
  }

  for (const child of parentNode.children) {
    if (isParentNode(tree, child.id, childId)) {
      return true
    }
  }

  return false
}
