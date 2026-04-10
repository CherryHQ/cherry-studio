import type { NotesTreeNode } from '@renderer/types/note'

export function normalizePathValue(path: string): string {
  return path.replace(/\\/g, '/')
}

export function addUniquePath(list: string[], path: string): string[] {
  const normalized = normalizePathValue(path)
  return list.includes(normalized) ? list : [...list, normalized]
}

export function removePathEntries(list: string[], path: string, deep: boolean): string[] {
  const normalized = normalizePathValue(path)
  const prefix = `${normalized}/`
  return list.filter((item) => {
    if (item === normalized) {
      return false
    }
    return !(deep && item.startsWith(prefix))
  })
}

export function replacePathEntries(list: string[], oldPath: string, newPath: string, deep: boolean): string[] {
  const oldNormalized = normalizePathValue(oldPath)
  const newNormalized = normalizePathValue(newPath)
  const prefix = `${oldNormalized}/`
  return list.map((item) => {
    if (item === oldNormalized) {
      return newNormalized
    }
    if (deep && item.startsWith(prefix)) {
      return `${newNormalized}${item.slice(oldNormalized.length)}`
    }
    return item
  })
}

export function findNode(tree: NotesTreeNode[], nodeId: string): NotesTreeNode | null {
  for (const node of tree) {
    if (node.id === nodeId) {
      return node
    }
    if (node.children) {
      const found = findNode(node.children, nodeId)
      if (found) {
        return found
      }
    }
  }
  return null
}

export function findNodeByPath(tree: NotesTreeNode[], targetPath: string): NotesTreeNode | null {
  for (const node of tree) {
    if (node.treePath === targetPath || node.externalPath === targetPath) {
      return node
    }
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath)
      if (found) {
        return found
      }
    }
  }
  return null
}

export function updateTreeNode(
  nodes: NotesTreeNode[],
  nodeId: string,
  updater: (node: NotesTreeNode) => NotesTreeNode
): NotesTreeNode[] {
  let changed = false

  const nextNodes = nodes.map((node) => {
    if (node.id === nodeId) {
      changed = true
      const updated = updater(node)
      if (updated.type === 'folder' && !updated.children) {
        return { ...updated, children: [] }
      }
      return updated
    }

    if (node.children && node.children.length > 0) {
      const updatedChildren = updateTreeNode(node.children, nodeId, updater)
      if (updatedChildren !== node.children) {
        changed = true
        return { ...node, children: updatedChildren }
      }
    }

    return node
  })

  return changed ? nextNodes : nodes
}

export function findParent(tree: NotesTreeNode[], nodeId: string): NotesTreeNode | null {
  for (const node of tree) {
    if (!node.children) {
      continue
    }
    if (node.children.some((child) => child.id === nodeId)) {
      return node
    }
    const found = findParent(node.children, nodeId)
    if (found) {
      return found
    }
  }
  return null
}

export function reorderTreeNodes(
  nodes: NotesTreeNode[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): NotesTreeNode[] {
  const [updatedNodes, moved] = reorderSiblings(nodes, sourceId, targetId, position)
  if (moved) {
    return updatedNodes
  }

  let changed = false
  const nextNodes = nodes.map((node) => {
    if (!node.children || node.children.length === 0) {
      return node
    }

    const reorderedChildren = reorderTreeNodes(node.children, sourceId, targetId, position)
    if (reorderedChildren !== node.children) {
      changed = true
      return { ...node, children: reorderedChildren }
    }

    return node
  })

  return changed ? nextNodes : nodes
}

function reorderSiblings(
  nodes: NotesTreeNode[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): [NotesTreeNode[], boolean] {
  const sourceIndex = nodes.findIndex((node) => node.id === sourceId)
  const targetIndex = nodes.findIndex((node) => node.id === targetId)

  if (sourceIndex === -1 || targetIndex === -1) {
    return [nodes, false]
  }

  const updated = [...nodes]
  const [sourceNode] = updated.splice(sourceIndex, 1)

  let insertIndex = targetIndex
  if (sourceIndex < targetIndex) {
    insertIndex -= 1
  }
  if (position === 'after') {
    insertIndex += 1
  }

  if (insertIndex < 0) {
    insertIndex = 0
  }
  if (insertIndex > updated.length) {
    insertIndex = updated.length
  }

  updated.splice(insertIndex, 0, sourceNode)
  return [updated, true]
}
