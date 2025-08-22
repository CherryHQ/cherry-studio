import { loggerService } from '@logger'
import db from '@renderer/databases'
import {
  findNodeByPath,
  findNodeInTree,
  findParentNode,
  getNotesTree,
  insertNodeIntoTree,
  isParentNode,
  moveNodeInTree,
  removeNodeFromTree,
  renameNodeFromTree
} from '@renderer/services/NotesTreeService'
import { NotesSortType, NotesTreeNode } from '@renderer/types/note'
import { v4 as uuidv4 } from 'uuid'

const MARKDOWN_EXT = '.md'
const NOTES_TREE_ID = 'notes-tree-structure'

const logger = loggerService.withContext('NotesService')

/**
 * 初始化/同步笔记树结构
 */
export async function initWorkSpace(folderPath: string): Promise<void> {
  const tree = await window.api.file.getDirectoryStructure(folderPath)
  await db.notes_tree.put({ id: NOTES_TREE_ID, tree })
}

/**
 * 创建新文件夹
 */
export async function createFolder(name: string, folderPath: string): Promise<NotesTreeNode> {
  const tree = await getNotesTree()
  const folderId = uuidv4()
  const { uniqueName, targetPath } = await ensureUniqueName(name, folderPath)

  const folder: NotesTreeNode = {
    id: folderId,
    name: uniqueName,
    treePath: `/${uniqueName}`,
    externalPath: targetPath,
    type: 'folder',
    children: [],
    expanded: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  await window.api.file.mkdir(targetPath)
  folder.externalPath = targetPath
  insertNodeIntoTree(tree, folder)

  return folder
}

/**
 * 创建新笔记文件
 */
export async function createNote(name: string, content: string = '', folderPath: string): Promise<NotesTreeNode> {
  const tree = await getNotesTree()
  const noteId = uuidv4()
  const { uniqueName, targetPath } = await ensureUniqueName(name, folderPath)
  const note: NotesTreeNode = {
    id: noteId,
    name: uniqueName,
    treePath: `/${uniqueName}`,
    externalPath: targetPath,
    type: 'file',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  await window.api.file.write(targetPath, content)
  insertNodeIntoTree(tree, note)

  return note
}

/**
 * 上传笔记
 */
export async function uploadNote(file: File, folderPath: string): Promise<NotesTreeNode> {
  const tree = await getNotesTree()
  const fileName = file.name.toLowerCase()
  if (!fileName.endsWith(MARKDOWN_EXT)) {
    throw new Error('Only markdown files are allowed')
  }

  const noteId = uuidv4()
  const baseName = fileName.replace(MARKDOWN_EXT, '')
  const { uniqueName, targetPath } = await ensureUniqueName(baseName, folderPath)

  const note: NotesTreeNode = {
    id: noteId,
    name: uniqueName,
    treePath: `/${uniqueName}`,
    externalPath: targetPath,
    type: 'file',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const content = await file.text()
  await window.api.file.write(targetPath, content)
  insertNodeIntoTree(tree, note)

  return note
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
  if (node.type === 'folder') {
    await window.api.file.deleteExternalDir(node.externalPath)
  } else if (node.type === 'file') {
    await window.api.file.deleteExternalFile(node.externalPath)
  }

  removeNodeFromTree(tree, nodeId)
}

/**
 * 重命名笔记或文件夹
 */
export async function renameNode(nodeId: string, newName: string): Promise<NotesTreeNode> {
  const tree = await getNotesTree()
  const node = findNodeInTree(tree, nodeId)
  if (!node) {
    throw new Error('Node not found')
  }
  if (node.type === 'file') {
    await window.api.file.rename(node.externalPath, newName)
  } else if (node.type === 'folder') {
    await window.api.file.renameDir(node.externalPath, newName)
  }
  return renameNodeFromTree(tree, nodeId, newName)
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
      logger.error(`Move nodes failed: node not found (source: ${sourceNodeId}, target: ${targetNodeId})`)
      return false
    }

    // 不允许文件夹被放入文件中
    if (position === 'inside' && targetNode.type === 'file' && sourceNode.type === 'folder') {
      logger.error('Move nodes failed: cannot move a folder inside a file')
      return false
    }

    // 不允许将节点移动到自身内部
    if (position === 'inside' && isParentNode(tree, sourceNodeId, targetNodeId)) {
      logger.error('Move nodes failed: cannot move a node inside itself or its descendants')
      return false
    }

    let targetPath: string = ''

    if (position === 'inside') {
      // 目标是文件夹内部
      if (targetNode.type === 'folder') {
        targetPath = targetNode.externalPath
      } else {
        logger.error('Cannot move node inside a file node')
        return false
      }
    } else {
      const targetParent = findParentNode(tree, targetNodeId)
      if (targetParent) {
        targetPath = targetParent.externalPath
      } else {
        // 目标节点在根级别，取其所在目录
        const pathParts = targetNode.externalPath!.split('/')
        pathParts.pop() // 移除最后一个部分（文件名或文件夹名）
        targetPath = pathParts.join('/')
      }
    }

    // 构建新的文件路径
    const sourceName = sourceNode.externalPath!.split('/').pop()!
    const newPath = `${targetPath}/${sourceName}`

    if (sourceNode.externalPath !== newPath) {
      try {
        if (sourceNode.type === 'folder') {
          await window.api.file.moveDir(sourceNode.externalPath, newPath)
        } else {
          await window.api.file.move(sourceNode.externalPath, newPath)
        }
        sourceNode.externalPath = newPath
        logger.debug(`Moved external ${sourceNode.type} to: ${newPath}`)
      } catch (error) {
        logger.error(`Failed to move external ${sourceNode.type}:`, error as Error)
        return false
      }
    }

    return await moveNodeInTree(tree, sourceNodeId, targetNodeId, position)
  } catch (error) {
    logger.error('Move nodes failed:', error as Error)
    return false
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

/**
 * 确保文件名唯一
 */
async function ensureUniqueName(
  baseName: string,
  folderPath: string
): Promise<{ uniqueName: string; targetPath: string }> {
  const tree = await getNotesTree()
  let uniqueName = baseName
  const isFile = !uniqueName.includes('.')
  const extension = isFile ? MARKDOWN_EXT : ''
  let targetPath = `${folderPath}/${uniqueName}${extension}`
  let counter = 1
  let treePath = folderPath === '/' ? `/${uniqueName}` : `${folderPath}/${uniqueName}`

  while (findNodeByPath(tree, treePath)) {
    uniqueName = `${baseName}${counter}`
    targetPath = `${folderPath}/${uniqueName}${extension}`
    treePath = folderPath === '/' ? `/${uniqueName}` : `${folderPath}/${uniqueName}`
    counter++
  }

  return { uniqueName, targetPath }
}
