import { loggerService } from '@logger'
import db from '@renderer/databases'
import FileManager from '@renderer/services/FileManager'
import store from '@renderer/store'
import { FileMetadata, FileTypes } from '@renderer/types'
import { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { v4 as uuidv4 } from 'uuid'

const MARKDOWN_EXT = '.md'
const NOTES_TREE_ID = 'notes-tree-structure'

const logger = loggerService.withContext('NotesService')

/**
 * 获取笔记树结构
 */
export async function getNotesTree(): Promise<NotesTreeNode[]> {
  try {
    const record = await db.notes_tree.get(NOTES_TREE_ID)
    const tree: NotesTreeNode[] = record?.tree || []

    await syncFile(tree)
    logger.debug('Notes tree loaded:', tree)
    return tree
  } catch (error) {
    logger.error('Failed to get notes tree:', error as Error)
    return []
  }
}

/**
 * 同步文件
 */
async function syncFile(tree: NotesTreeNode[]): Promise<void> {
  const fileIds: string[] = []
  collectFileIds(tree, fileIds)

  if (fileIds.length === 0) return

  try {
    const filesMetadata = await Promise.all(fileIds.map((id) => FileManager.getFile(id)))
    const validFiles = filesMetadata.filter((file) => file && typeof file === 'object' && 'id' in file)
    const metadataMap = new Map(validFiles.map((file) => [file!.id, file!]))
    const deletedFileIds = fileIds.filter((id) => !metadataMap.has(id))

    let hasChanges = false

    const nameChanges = updateFileNames(tree, metadataMap)
    hasChanges = hasChanges || nameChanges

    // 删除不存在的文件节点
    if (deletedFileIds.length > 0) {
      const deleteChanges = removeDeletedFiles(tree, deletedFileIds)
      hasChanges = hasChanges || deleteChanges
    }

    if (hasChanges) {
      await saveNotesTree(tree)
    }
  } catch (error) {
    logger.error('Failed to sync files:', error as Error)
  }
}

/**
 * 收集树中所有文件节点的ID
 */
function collectFileIds(tree: NotesTreeNode[], fileIds: string[]): void {
  for (const node of tree) {
    if (node.type === 'file' && node.fileId) {
      fileIds.push(node.fileId)
    }
    if (node.children && node.children.length > 0) {
      collectFileIds(node.children, fileIds)
    }
  }
}

/**
 * 更新树中的文件名称
 */
function updateFileNames(tree: NotesTreeNode[], metadataMap: Map<string, any>): boolean {
  let hasChanges = false

  for (const node of tree) {
    if (node.type === 'file' && node.fileId) {
      const metadata = metadataMap.get(node.fileId)
      if (metadata && metadata.origin_name !== node.name) {
        node.name = metadata.origin_name
        node.updatedAt = new Date().toISOString()
        hasChanges = true
      }
    }
    if (node.children && node.children.length > 0) {
      const childChanges = updateFileNames(node.children, metadataMap)
      hasChanges = hasChanges || childChanges
    }
  }

  return hasChanges
}

/**
 * 删除树中已删除的文件节点
 */
function removeDeletedFiles(tree: NotesTreeNode[], deletedFileIds: string[]): boolean {
  let hasChanges = false

  for (let i = tree.length - 1; i >= 0; i--) {
    const node = tree[i]
    if (node.type === 'file' && node.fileId && deletedFileIds.includes(node.fileId)) {
      tree.splice(i, 1)
      hasChanges = true
      logger.info(`Removed deleted file node: ${node.name} (${node.fileId})`)
    } else if (node.children && node.children.length > 0) {
      const childChanges = removeDeletedFiles(node.children, deletedFileIds)
      hasChanges = hasChanges || childChanges
    }
  }

  return hasChanges
}

/**
 * 保存笔记树结构
 */
export async function saveNotesTree(tree: NotesTreeNode[]): Promise<void> {
  try {
    await db.notes_tree.put({ id: NOTES_TREE_ID, tree })
  } catch (error) {
    logger.error('Failed to save notes tree:', error as Error)
  }
}

/**
 * 创建新文件夹
 */
export async function createFolder(name: string, parentId?: string): Promise<NotesTreeNode> {
  const folderId = uuidv4()

  const folder: NotesTreeNode = {
    id: folderId,
    name,
    type: 'folder',
    children: [],
    expanded: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const tree = await getNotesTree()
  insertNodeIntoTree(tree, folder, parentId)
  await saveNotesTree(tree)

  return folder
}

/**
 * 创建新笔记文件
 */
export async function createNote(name: string, content: string = '', parentId?: string): Promise<NotesTreeNode> {
  const noteId = uuidv4()
  const filesPath = store.getState().runtime.filesPath

  try {
    const fileMetadata: FileMetadata = {
      id: noteId,
      name: noteId + MARKDOWN_EXT,
      origin_name: name,
      path: `${filesPath}/${noteId}${MARKDOWN_EXT}`,
      size: content.length,
      ext: MARKDOWN_EXT,
      type: FileTypes.TEXT,
      created_at: new Date().toISOString(),
      count: 1
    }

    await window.api.file.writeWithId(fileMetadata.id + fileMetadata.ext, content)
    await FileManager.addFile(fileMetadata)

    // 创建树节点
    const note: NotesTreeNode = {
      id: noteId,
      name: name,
      type: 'file',
      treePath: getNodePath(name, parentId),
      fileId: noteId,
      createdAt: fileMetadata.created_at,
      updatedAt: fileMetadata.created_at
    }

    const tree = await getNotesTree()
    insertNodeIntoTree(tree, note, parentId)
    await saveNotesTree(tree)

    return note
  } catch (error) {
    logger.error('Failed to create note:', error as Error)
    throw error
  }
}

/**
 * 更新笔记内容
 */
export async function updateNote(node: NotesTreeNode, content: string): Promise<void> {
  if (node.type !== 'file' || !node.fileId) {
    throw new Error('Invalid note node')
  }

  try {
    const fileMetadata = await FileManager.getFile(node.fileId)
    if (!fileMetadata) {
      throw new Error('Note file not found in database')
    }

    await window.api.file.writeWithId(fileMetadata.id + fileMetadata.ext, content)
    await db.files.update(fileMetadata.id, {
      size: content.length,
      count: fileMetadata.count + 1
    })

    const tree = await getNotesTree()
    const targetNode = findNodeInTree(tree, node.id)
    if (targetNode) {
      targetNode.updatedAt = new Date().toISOString()
      await saveNotesTree(tree)
    }
  } catch (error) {
    logger.error('Failed to update note:', error as Error)
    throw error
  }
}

/**
 * 删除笔记或文件夹
 */
export async function deleteNode(nodeId: string): Promise<void> {
  const tree = await getNotesTree()
  const node = findNodeInTree(tree, nodeId)

  if (!node) {
    throw new Error('Node not found')
  }

  try {
    await deleteNodeRecursively(node)
    removeNodeFromTree(tree, nodeId)
    await saveNotesTree(tree)
  } catch (error) {
    logger.error('Failed to delete node:', error as Error)
    throw error
  }
}

/**
 * 上传笔记
 */
export async function uploadNote(file: File): Promise<NotesTreeNode> {
  try {
    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith(MARKDOWN_EXT)) {
      return Promise.reject(new Error('Only markdown files are allowed'))
    }

    const noteId = uuidv4()
    const filesPath = store.getState().runtime.filesPath
    const content = await file.text()
    const fileMetadata: FileMetadata = {
      id: noteId,
      name: noteId + MARKDOWN_EXT,
      origin_name: file.name,
      path: `${filesPath}/${noteId}${MARKDOWN_EXT}`,
      size: content.length,
      ext: MARKDOWN_EXT,
      type: FileTypes.TEXT,
      created_at: new Date().toISOString(),
      count: 1
    }

    await window.api.file.writeWithId(fileMetadata.id + fileMetadata.ext, content)
    await FileManager.addFile(fileMetadata)

    // 创建树节点
    const note: NotesTreeNode = {
      id: noteId,
      name: file.name,
      type: 'file',
      treePath: `/${file.name}`,
      fileId: noteId,
      createdAt: fileMetadata.created_at,
      updatedAt: fileMetadata.created_at
    }

    // 将节点添加到根目录
    const tree = await getNotesTree()
    tree.push(note)
    await saveNotesTree(tree)

    logger.info(`Upload note file successfully: ${file.name}`)
    return note
  } catch (error) {
    logger.error('Upload note failed:', error as Error)
    throw error
  }
}

/**
 * 重命名节点
 */
export async function renameNode(nodeId: string, newName: string): Promise<void> {
  const tree = await getNotesTree()
  const node = findNodeInTree(tree, nodeId)

  if (!node) {
    throw new Error('Node not found')
  }

  // 更新节点名称
  node.name = newName
  node.updatedAt = new Date().toISOString()

  // 如果是文件类型，还需要更新文件记录
  if (node.type === 'file' && node.fileId) {
    try {
      // 获取文件元数据
      const fileMetadata = await FileManager.getFile(node.fileId)
      if (fileMetadata) {
        // 更新文件的原始名称（显示名称）
        await db.files.update(node.fileId, {
          origin_name: newName
        })
      }
    } catch (error) {
      logger.error('Failed to update file metadata:', error as Error)
      throw error
    }
  }

  await saveNotesTree(tree)
}

/**
 * 切换节点展开状态
 */
export async function toggleNodeExpanded(nodeId: string): Promise<void> {
  const tree = await getNotesTree()
  const node = findNodeInTree(tree, nodeId)

  if (node && node.type === 'folder') {
    node.expanded = !node.expanded
    await saveNotesTree(tree)
  }
}

/**
 * 切换收藏状态
 */
export async function toggleStarred(nodeId: string): Promise<void> {
  const tree = await getNotesTree()
  const node = findNodeInTree(tree, nodeId)

  if (node) {
    node.is_starred = !node.is_starred
    await saveNotesTree(tree)
  }
}

/**
 * 移动节点
 */
export async function moveNode(
  sourceNodeId: string,
  targetNodeId: string,
  position: 'before' | 'after' | 'inside'
): Promise<boolean> {
  try {
    const tree = await getNotesTree()

    // 找到源节点和目标节点
    const sourceNode = findNodeInTree(tree, sourceNodeId)
    const targetNode = findNodeInTree(tree, targetNodeId)

    if (!sourceNode || !targetNode) {
      logger.error(`Sort nodes failed: node not found (source: ${sourceNodeId}, target: ${targetNodeId})`)
      return false
    }

    // 不允许文件夹被放入文件中
    if (position === 'inside' && targetNode.type === 'file' && sourceNode.type === 'folder') {
      logger.error('Sort nodes failed: cannot move a folder inside a file')
      return false
    }

    // 不允许将节点移动到自身内部
    if (position === 'inside' && isParentNode(tree, sourceNodeId, targetNodeId)) {
      logger.error('Sort nodes failed: cannot move a node inside itself or its descendants')
      return false
    }

    // 首先从原位置移除节点
    removeNodeFromTree(tree, sourceNodeId)

    // 根据位置进行放置
    if (position === 'inside' && targetNode.type === 'folder') {
      if (!targetNode.children) {
        targetNode.children = []
      }
      targetNode.children.push(sourceNode)
      targetNode.expanded = true

      // 更新节点路径（如果是文件类型）
      if (sourceNode.type === 'file') {
        sourceNode.treePath = getNodePath(sourceNode.name, targetNode.id)
      }
    } else {
      // 放在目标节点前面或后面
      const targetParent = findParentNode(tree, targetNodeId)
      const targetList = targetParent ? targetParent.children! : tree
      const targetIndex = targetList.findIndex((node) => node.id === targetNodeId)

      if (targetIndex === -1) {
        logger.error('Sort nodes failed: target position not found')
        return false
      }

      // 根据position确定插入位置
      const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
      targetList.splice(insertIndex, 0, sourceNode)

      // 更新节点路径（如果是文件类型）
      if (sourceNode.type === 'file') {
        sourceNode.treePath = getNodePath(sourceNode.name, targetParent?.id)
      }
    }

    // 更新修改时间
    sourceNode.updatedAt = new Date().toISOString()

    // 保存树结构
    await saveNotesTree(tree)
    return true
  } catch (error) {
    logger.error('Sort nodes failed:', error as Error)
    return false
  }
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

/**
 * 获取节点文件树路径
 */
function getNodePath(name: string, parentId?: string): string {
  if (!parentId) {
    return `/${name}`
  }
  // 递归构建父节点路径
  const parentPath = buildNodePath(parentId)
  return `${parentPath}/${name}`
}

/**
 * 获取从根节点到指定节点的完整节点路径数组
 */
export async function getNodePathArray(tree: NotesTreeNode[], nodeId: string): Promise<NotesTreeNode[]> {
  const result: NotesTreeNode[] = []

  const currentNode = findNodeInTree(tree, nodeId)
  if (!currentNode) {
    return result
  }

  result.push(currentNode)

  const parent = findParentNode(tree, nodeId)
  if (parent) {
    const parentPath = await getNodePathArray(tree, parent.id)
    return [...parentPath, ...result]
  }

  return result
}

/**
 * 递归构建节点路径
 */
function buildNodePath(nodeId: string): Promise<string> {
  return new Promise((resolve) => {
    db.notes_tree
      .get(NOTES_TREE_ID)
      .then((record) => {
        const tree: NotesTreeNode[] = record?.tree || []

        const node = findNodeInTree(tree, nodeId)
        if (!node) {
          resolve(`/${nodeId}`)
          return
        }

        // 递归查找父节点路径
        const parentNode = findParentNode(tree, nodeId)
        if (!parentNode) {
          resolve(`/${node.name}`)
          return
        }

        buildNodePath(parentNode.id)
          .then((parentPath) => {
            resolve(`${parentPath}/${node.name}`)
          })
          .catch((error) => {
            logger.error('Failed to build node path:', error as Error)
            resolve(`/${nodeId}`)
          })
      })
      .catch((error) => {
        logger.error('Failed to build node path:', error as Error)
        resolve(`/${nodeId}`)
      })
  })
}

/**
 * 查找节点的父节点
 */
function findParentNode(tree: NotesTreeNode[], targetNodeId: string): NotesTreeNode | null {
  for (const node of tree) {
    if (node.children) {
      // 检查是否是直接子节点
      const isDirectChild = node.children.some((child) => child.id === targetNodeId)
      if (isDirectChild) {
        return node
      }

      // 递归查找
      const parent = findParentNode(node.children, targetNodeId)
      if (parent) {
        return parent
      }
    }
  }
  return null
}

/**
 * 在树中插入节点
 */
function insertNodeIntoTree(tree: NotesTreeNode[], node: NotesTreeNode, parentId?: string): void {
  if (!parentId) {
    tree.push(node)
    return
  }

  const parent = findNodeInTree(tree, parentId)
  if (parent && parent.type === 'folder') {
    if (!parent.children) {
      parent.children = []
    }
    parent.children.push(node)
  }
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
 * 从树中移除节点
 */
function removeNodeFromTree(tree: NotesTreeNode[], nodeId: string): boolean {
  for (let i = 0; i < tree.length; i++) {
    if (tree[i].id === nodeId) {
      tree.splice(i, 1)
      return true
    }
    if (tree[i].children) {
      const removed = removeNodeFromTree(tree[i].children!, nodeId)
      if (removed) {
        return true
      }
    }
  }
  return false
}

/**
 * 递归删除节点及其文件
 */
async function deleteNodeRecursively(node: NotesTreeNode): Promise<void> {
  if (node.type === 'file' && node.fileId) {
    try {
      await FileManager.deleteFile(node.fileId, true)
    } catch (error) {
      logger.error(`Failed to delete file with id ${node.fileId}:`, error as Error)
    }
  } else if (node.type === 'folder' && node.children) {
    for (const child of node.children) {
      await deleteNodeRecursively(child)
    }
  }
}

/**
 * 对笔记树的同一层级节点进行排序
 */
export async function sortNotes(sortType: NotesSortType, folderId?: string): Promise<void> {
  try {
    const tree = await getNotesTree()

    // 确定要排序的节点列表
    let nodesToSort: NotesTreeNode[] = tree
    if (folderId) {
      const folderNode = findNodeInTree(tree, folderId)
      if (!folderNode || folderNode.type !== 'folder' || !folderNode.children) {
        logger.error(`Failed to sort notes: folder node not found or invalid - ${folderId}`)
        return
      }
      nodesToSort = folderNode.children
    }

    // 执行排序
    sortNodesArray(nodesToSort, sortType)

    // 保存更改后的树结构
    await saveNotesTree(tree)
    logger.info(`Sorted notes successfully: ${sortType} ${folderId ? `in folder ${folderId}` : 'at root level'}`)
  } catch (error) {
    logger.error('Failed to sort notes:', error as Error)
    throw error
  }
}

/**
 * 对节点数组进行排序
 */
function sortNodesArray(nodes: NotesTreeNode[], sortType: NotesSortType): void {
  // 首先分离文件夹和文件
  const folders: NotesTreeNode[] = nodes.filter((node) => node.type === 'folder')
  const files: NotesTreeNode[] = nodes.filter((node) => node.type === 'file')

  // 根据排序类型对文件夹和文件分别进行排序
  const sortFunction = getSortFunction(sortType)
  folders.sort(sortFunction)
  files.sort(sortFunction)

  // 清空原数组并重新填入排序后的节点
  nodes.length = 0
  nodes.push(...folders, ...files)
}

/**
 * 根据排序类型获取相应的排序函数
 */
function getSortFunction(sortType: NotesSortType): (a: NotesTreeNode, b: NotesTreeNode) => number {
  switch (sortType) {
    case 'sort_a2z':
      return (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' })

    case 'sort_z2a':
      return (a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'accent' })

    case 'sort_updated_desc':
      return (a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return timeB - timeA
      }

    case 'sort_updated_asc':
      return (a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return timeA - timeB
      }

    case 'sort_created_desc':
      return (a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return timeB - timeA
      }

    case 'sort_created_asc':
      return (a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return timeA - timeB
      }

    default:
      return (a, b) => a.name.localeCompare(b.name)
  }
}

/**
 * 递归排序笔记树中的所有层级
 */
export async function sortAllLevels(sortType: NotesSortType): Promise<void> {
  try {
    const tree = await getNotesTree()
    sortNodesArray(tree, sortType)
    recursiveSortNodes(tree, sortType)
    await saveNotesTree(tree)
    logger.info(`Sorted all levels of notes successfully: ${sortType}`)
  } catch (error) {
    logger.error('Failed to sort all levels of notes:', error as Error)
    throw error
  }
}

/**
 * 递归对节点中的子节点进行排序
 */
function recursiveSortNodes(nodes: NotesTreeNode[], sortType: NotesSortType): void {
  for (const node of nodes) {
    if (node.type === 'folder' && node.children && node.children.length > 0) {
      sortNodesArray(node.children, sortType)
      recursiveSortNodes(node.children, sortType)
    }
  }
}
